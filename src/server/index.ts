import express from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createRuntime } from './runtime.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(resolve(root, '.env')))
    loadEnvFile(resolve(root, '.env'));
const production = process.env.NODE_ENV === 'production';
const { app, db } = await createRuntime();
const themeScript = readFileSync(resolve(root, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const themeHash = createHash('sha256').update(themeScript).digest('base64');
app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    if (production) {
        res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'sha256-${themeHash}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
        res.set('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
});
const dist = resolve(root, 'dist');
if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(['/', '/tv/:id'], (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
app.use((_req, res) => res.status(404).json({ erro: 'Recurso não encontrado.' }));
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, host, () => console.log(`Liga Enge: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close(() => { db.close(); process.exit(0); }));
