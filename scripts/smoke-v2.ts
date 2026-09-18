import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/database.js';
import { hashPassword } from '../src/server/auth.js';
import { Store } from '../src/v2/store.js';
import { League } from '../src/v2/service.js';
import { users } from '../src/v2/auth.js';
import { defaults } from '../src/v2/model.js';
const password = 'teste-local-navegador';
const passwordHash = await hashPassword(password);
const db = await openDatabase(':memory:');
const app = await createApp(db, { username: 'admin', passwordHash, secure: false, origin: 'http://127.0.0.1:3189' });
app.use(express.static(resolve('dist')));
app.get('/tv/:id', (_req, res) => res.sendFile(resolve('dist/index.html')));
const store = new Store(db), league = new League(store), admin = (await users(store))[0];
const season = await store.transaction(async () => (await league.createSeason(admin, 2026, defaults)));
const server = app.listen(3189, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const profile = mkdtempSync(join(tmpdir(), 'liga-browser-'));
const chrome = spawn(process.env.BROWSER_PATH ?? '/home/pedro-campos/.cache/puppeteer/chrome/linux-151.0.7922.77/chrome-linux64/chrome', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws: WebSocket | undefined;
try {
    const debuggerUrl = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Chrome não iniciou')), 15000);
        chrome.stderr.on('data', chunk => {
            const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
        chrome.once('exit', code => reject(new Error('Chrome encerrou ' + code)));
    });
    const endpoint = new URL(debuggerUrl);
    const target = await (await fetch(`http://${endpoint.host}/json/new?http://127.0.0.1:3189`, { method: 'PUT' })).json() as {
        webSocketDebuggerUrl: string;
    };
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws!.onopen = () => r(); ws!.onerror = () => j(new Error('CDP indisponível')); });
    let sequence = 0;
    const pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
    }>();
    ws.onmessage = e => {
        const msg = JSON.parse(String(e.data));
        if (msg.id) {
            const p = pending.get(msg.id);
            if (p) {
                pending.delete(msg.id);
                if (msg.error)
                    p.reject(new Error(JSON.stringify(msg.error)));
                else
                    p.resolve(msg.result);
            }
        }
    };
    const call = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression: string) => {
        const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails)
            throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const waitFor = async (expression: string) => {
        for (let i = 0; i < 150; i++) {
            if (await evaluate(expression))
                return;
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Espera excedida: ' + expression);
    };
    await call('Page.enable');
    await waitFor(`!!document.querySelector('input[name="password"]')`);
    await evaluate(`document.querySelector('input[name="username"]').value='admin';document.querySelector('input[name="password"]').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit();`);
    await waitFor(`document.body.innerText.includes('Visão geral')`);
    for (const label of ['Happy hours', 'Torneios', 'Rankings', 'Copa e finais', 'Meu perfil', 'Temporadas', 'Auditoria', 'Usuários']) {
        await evaluate(`Array.from(document.querySelectorAll('.sidebar nav button')).find(b=>b.textContent.startsWith(${JSON.stringify(label)})).click()`);
        await waitFor(`document.querySelector('h1')?.textContent===${JSON.stringify(label)}`);
        assert.ok(await evaluate(`!!document.querySelector('.app-shell main .panel')`), label + ' sem conteúdo');
    }
    await evaluate(`Array.from(document.querySelectorAll('.sidebar nav button')).find(b=>b.textContent==='Visão geral').click()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 250));
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/liga-v2-desktop.png', Buffer.from(shot.data, 'base64'));
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise(r => setTimeout(r, 250));
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth+2'), 'Layout móvel transborda');
    await evaluate(`document.querySelector('header button[aria-label="Alternar tema"]').click()`);
    const theme = await evaluate('document.documentElement.dataset.theme');
    assert.ok(['dark', 'light'].includes(theme));
    const mobile = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/liga-v2-mobile.png', Buffer.from(mobile.data, 'base64'));
    const exported = await evaluate(`fetch('/api/export/pdf?seasonId=${season.id}').then(async r=>({status:r.status,type:r.headers.get('content-type'),prefix:(await r.text()).slice(0,4)}))`);
    assert.equal(exported.status, 200);
    assert.equal(exported.prefix, '%PDF');
    console.log('Navegador: login, 8 áreas, tema, layout móvel e export PDF verificados. Capturas em /tmp/liga-v2-desktop.png e /tmp/liga-v2-mobile.png.');
}
finally {
    ws?.close();
    chrome.kill('SIGTERM');
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
}
