import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRuntime } from '../src/server/runtime.js';
import { startupDiagnostic } from '../src/server/startup-error.js';

let runtime: ReturnType<typeof createRuntime> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // Share initialization in a warm instance, but retry after transient failures.
    runtime ??= createRuntime().catch(error => { runtime = undefined; throw error; });
    const { app } = await runtime;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        res.off('finish', done);
        res.off('close', done);
        resolve();
      };
      res.once('finish', done);
      res.once('close', done);
      try { app(req, res); } catch (error) { reject(error); }
    });
  } catch (error) {
    console.error('Falha ao iniciar API', JSON.stringify(startupDiagnostic(error)));
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ erro: 'API indisponível. Verifique a configuração do banco e do administrador.' }));
  }
}
