import { createApp } from './app.js';
import { databaseTarget, openDatabase } from './database.js';

export async function createRuntime(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production' || !!env.VERCEL;
  const origin = env.APP_ORIGIN ?? (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://127.0.0.1:5173');
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN deve ser a origem do site, sem barra final e com HTTPS em produção.');
  }
  const target = databaseTarget(env);
  const db = await openDatabase(target.url, target.authToken);
  try {
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
}
