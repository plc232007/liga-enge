import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export interface AuthConfig { username: string; passwordHash: string; secure: boolean; origin: string }
const ttl = 8 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export function installAuth(app: Express, db: Database.Database, config: AuthConfig) {
  if (!config.username || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(config.passwordHash)) {
    throw new Error('Configure o acesso com npm run setup antes de iniciar.');
  }
  const cookieName = config.secure ? '__Host-liga_session' : 'liga_session';
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'strict' as const, path: '/' };
  const tokenFrom = (req: Request) => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
  // Limite global intencional para uma instalação com um administrador; também cobre tentativas distribuídas.
  let windowStart = Date.now();
  let attempts = 0;
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== config.origin) {
      return res.status(403).json({ erro: 'Origem não permitida.' });
    }
    next();
  });
  app.post('/api/auth/login', async (req, res) => {
    if (Date.now() - windowStart >= 15 * 60 * 1000) { attempts = 0; windowStart = Date.now(); }
    if (++attempts > 10) { res.set('Retry-After', String(Math.ceil((windowStart + 15 * 60 * 1000 - Date.now()) / 1000))); return res.status(429).json({ erro: 'Muitas tentativas. Tente novamente em 15 minutos.' }); }
    const { username, password } = z.object({ username: z.string().max(100), password: z.string().min(1).max(200) }).strict().parse(req.body);
    const [salt, expected] = config.passwordHash.split(':');
    const key = await derive(password, salt);
    if (!timingSafeEqual(key, Buffer.from(expected, 'hex')) || username !== config.username) return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    const token = randomBytes(32).toString('hex');
    db.transaction(() => {
      db.prepare('DELETE FROM sessao WHERE expira_em <= ? OR token_hash = ?').run(Date.now(), hashToken(tokenFrom(req)));
      db.prepare('INSERT INTO sessao(token_hash, expira_em, credencial) VALUES (?,?,?)').run(hashToken(token), Date.now() + ttl, hashToken(config.username + config.passwordHash));
    })();
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: ttl }).json({ username: config.username });
  });
  app.use('/api', (req, res, next) => {
    const token = tokenFrom(req);
    const session = /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT 1 FROM sessao WHERE token_hash=? AND expira_em>? AND credencial=?')
      .get(hashToken(token), Date.now(), hashToken(config.username + config.passwordHash));
    if (!session) return res.status(401).json({ erro: 'Entre para acessar a liga.' });
    next();
  });
  app.get('/api/auth/me', (_req, res) => res.json({ username: config.username }));
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessao WHERE token_hash=?').run(hashToken(tokenFrom(req)));
    res.clearCookie(cookieName, cookieOptions).status(204).end();
  });
}
