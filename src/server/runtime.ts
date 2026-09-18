import { createApp } from './app.js';
import { databaseTarget, openDatabase } from './database.js';
import { StartupError, type StartupStage } from './startup-error.js';

export async function createRuntime(env: NodeJS.ProcessEnv = process.env) {
  let stage: StartupStage = 'origem';
  try {
    const production = env.NODE_ENV === 'production' || !!env.VERCEL;
    const origin = env.APP_ORIGIN ?? (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://127.0.0.1:5173');
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (production && parsed.protocol !== 'https:')) {
      throw new Error('APP_ORIGIN deve ser a origem do site, sem barra final e com HTTPS em produção.');
    }
    stage = 'configuracao-banco';
    const target = databaseTarget(env);
    stage = 'conexao-banco';
    const db = await openDatabase(target.url, target.authToken);
    try {
      stage = 'aplicacao';
      const app = await createApp(db, {
        username: env.ADMIN_USERNAME ?? '',
        passwordHash: env.ADMIN_PASSWORD_HASH ?? '',
        secure: production,
        origin,
      });
      return { app, db };
    } catch (error) {
      db.close();
      throw error;
    }
  } catch (error) {
    throw new StartupError(stage, error);
  }
}
