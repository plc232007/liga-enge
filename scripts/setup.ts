import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hashPassword } from '../src/server/auth.js';

const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
const target = new URL('../.env', import.meta.url);
try {
  writeFileSync(target, `ADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH=${hash}\nAPP_ORIGIN=http://127.0.0.1:5173\nHOST=127.0.0.1\nPORT=3001\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Acesso criado. Guarde a senha em um gerenciador de senhas.\nUsuário: admin\nSenha: ${password}\nA senha não será exibida novamente. Configuração salva em .env.`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('O arquivo .env já existe. Ele foi preservado.');
  throw error;
}
