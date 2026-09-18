import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthConfig } from '../server/auth.js';
import { hashPassword } from '../server/auth.js';
import { Store } from './store.js';
import type { Role, User } from './model.js';
import { ensure } from './rules.js';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const roles: Role[] = ['jogador', 'mesario', 'organizador', 'admin'];
export async function users(store: Store): Promise<User[]> {
    return ((await store.db.prepare('SELECT * FROM v2_user ORDER BY nome').all()) as {
        id: string;
        nome: string;
        username: string;
        email: string;
        roles: string;
        ativo: number;
        password_hash: string;
    }[]).map(r => ({ id: r.id, nome: r.nome, username: r.username, email: r.email, roles: JSON.parse(r.roles), ativo: !!r.ativo, passwordHash: r.password_hash }));
}
export const publicUser = ({ passwordHash, ...user }: User) => user;
export function actor(req: Request): User {
    return (req as Request & {
        actor: User;
    }).actor;
}
export const hasRole = (user: User, ...allowed: Role[]) => user.roles.some(r => allowed.includes(r));
export function requireRoles(...allowed: Role[]): RequestHandler { return (req, _res, next) => { ensure(hasRole(actor(req), ...allowed), 'Seu perfil não permite esta operação.', 403); next(); }; }
export async function rate(store: Store, key: string, limit: number, period = 60000) {
    await store.transaction(async () => {
        const now = Date.now();
        const row = (await store.db.prepare('SELECT start,count FROM v2_rate WHERE key=?').get(key)) as {
            start: number;
            count: number;
        } | undefined;
        if (!row || now - row.start > period)
            await store.db.prepare('INSERT OR REPLACE INTO v2_rate VALUES (?,?,1)').run(key, now);
        else {
            ensure(row.count < limit, 'Muitas tentativas. Aguarde antes de tentar novamente.', 429);
            await store.db.prepare('UPDATE v2_rate SET count=count+1 WHERE key=?').run(key);
        }
    });
}
export async function auth(app: Express, store: Store, config: AuthConfig) {
    ensure(config.username && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(config.passwordHash), 'Configure o acesso com npm run setup.');
    let admin = (await users(store)).find(u => u.username === config.username);
    if (!admin) {
        admin = { id: randomUUID(), nome: 'Administrador', username: config.username, email: '', roles: ['admin', 'organizador', 'mesario', 'jogador'], ativo: true, passwordHash: config.passwordHash };
        await store.db.prepare('INSERT INTO v2_user VALUES (?,?,?,?,?,?,?)').run(admin.id, admin.nome, admin.username, admin.email, JSON.stringify(admin.roles), 1, admin.passwordHash);
    }
    else if (admin.passwordHash !== config.passwordHash)
        await store.db.prepare('UPDATE v2_user SET password_hash=? WHERE id=?').run(config.passwordHash, admin.id);
    const cookie = config.secure ? '__Host-liga_session' : 'liga_session';
    const opts = { httpOnly: true, secure: config.secure, sameSite: 'strict' as const, path: '/' };
    const token = (req: Request) => req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookie}=`))?.slice(cookie.length + 1) ?? '';
    app.use('/api', (req, _res, next) => {
        if (!['GET', 'HEAD'].includes(req.method)) {
            ensure(req.headers['sec-fetch-site'] !== 'cross-site' && (!req.headers.origin || req.headers.origin === config.origin), 'Origem não permitida.', 403);
            ensure(req.is('application/json'), 'Envie JSON.', 415);
        }
        next();
    });
    app.post('/api/auth/login', async (req, res) => {
        await rate(store, `login:${req.ip}`, 10, 15 * 60000);
        const input = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }).strict().parse(req.body);
        const user = (await users(store)).find(u => u.username.toLowerCase() === input.username.toLowerCase() || !!u.email && u.email.toLowerCase() === input.username.toLowerCase());
        const [salt, expected] = (user?.passwordHash ?? config.passwordHash).split(':');
        const derived = await new Promise<Buffer>((resolve, reject) => scrypt(input.password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
        ensure(timingSafeEqual(derived, Buffer.from(expected, 'hex')) && user?.ativo, 'Usuário ou senha inválidos.', 401);
        const value = randomBytes(32).toString('hex');
        await store.transaction(async () => { await store.db.prepare('DELETE FROM v2_session WHERE expira_em<? OR token_hash=?').run(Date.now(), hash(token(req))); await store.db.prepare('INSERT INTO v2_session VALUES (?,?,?,?)').run(hash(value), user.id, Date.now() + 8 * 3600000, hash(user.passwordHash)); });
        res.cookie(cookie, value, { ...opts, maxAge: 8 * 3600000 }).json(publicUser(user));
    });
    app.use('/api', async (req, res, next) => {
        if (req.path.startsWith('/public/'))
            return next();
        const value = token(req);
        const session = /^[a-f0-9]{64}$/.test(value) ? (await store.db.prepare('SELECT user_id,credencial FROM v2_session WHERE token_hash=? AND expira_em>?').get(hash(value), Date.now())) as {
            user_id: string;
            credencial: string;
        } | undefined : undefined;
        const user = session ? (await users(store)).find(u => u.id === session.user_id && u.ativo && hash(u.passwordHash) === session.credencial) : undefined;
        ensure(user, 'Entre para acessar a liga.', 401);
        (req as Request & {
            actor: User;
        }).actor = user;
        next();
    });
    app.get('/api/auth/me', (req, res) => res.json(publicUser(actor(req))));
    app.post('/api/auth/logout', async (req, res) => { await store.db.prepare('DELETE FROM v2_session WHERE token_hash=?').run(hash(token(req))); res.clearCookie(cookie, opts).status(204).end(); });
    app.post('/api/users', requireRoles('admin'), async (req, res) => {
        const dto = z.object({ nome: z.string().trim().min(1).max(80), username: z.string().regex(/^[a-zA-Z0-9._-]{3,60}$/), email: z.email(), roles: z.array(z.enum(['jogador', 'mesario', 'organizador', 'admin'])).min(1) }).strict().parse(req.body);
        ensure(!(await users(store)).some(u => u.username.toLowerCase() === dto.username.toLowerCase() || u.email.toLowerCase() === dto.email.toLowerCase()), 'Usuário ou e-mail já cadastrado.', 409);
        const password = randomBytes(18).toString('base64url');
        const passwordHash = await hashPassword(password);
        const user = { ...dto, id: randomUUID(), ativo: true, passwordHash };
        await store.transaction(async () => { await store.db.prepare('INSERT INTO v2_user VALUES (?,?,?,?,?,?,?)').run(user.id, user.nome, user.username, user.email, JSON.stringify(user.roles), 1, passwordHash); await store.audit('user', user.id, 'CRIAR', null, publicUser(user), actor(req).id); });
        res.status(201).json({ ...publicUser(user), senhaTemporaria: password });
    });
    app.put('/api/users/:id', requireRoles('admin'), async (req, res) => { const dto = z.object({ nome: z.string().trim().min(1).max(80), roles: z.array(z.enum(['jogador', 'mesario', 'organizador', 'admin'])).min(1), ativo: z.boolean() }).strict().parse(req.body); const user = (await users(store)).find(u => u.id === req.params.id); ensure(user, 'Usuário não encontrado.', 404); ensure(user.username !== config.username || dto.ativo && dto.roles.includes('admin'), 'Preserve o administrador de configuração.'); await store.transaction(async () => { await store.db.prepare('UPDATE v2_user SET nome=?,roles=?,ativo=? WHERE id=?').run(dto.nome, JSON.stringify(dto.roles), dto.ativo ? 1 : 0, user.id); await store.audit('user', user.id, 'ALTERAR', publicUser(user), { ...publicUser(user), ...dto }, actor(req).id); }); res.json({ ok: true }); });
}
