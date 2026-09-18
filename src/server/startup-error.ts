import { TursoHttpError } from './turso-fetch.js';

export type StartupStage = 'origem' | 'configuracao-banco' | 'conexao-banco' | 'aplicacao';

export class StartupError extends Error {
  constructor(public readonly stage: StartupStage, cause: unknown) {
    super(`Falha na inicialização: ${stage}`, { cause });
    this.name = 'StartupError';
  }
}

// Do not log raw messages, URLs, inputs or arbitrary error objects. Only the
// Turso transport's redacted message may accompany types, codes and locations.
export function startupDiagnostic(error: unknown) {
  const etapa = error instanceof StartupError ? error.stage : 'requisicao';
  const causas: { tipo: string; codigo?: string; statusHttp?: number; motivo?: string; formatoToken?: string; mensagemServidor?: string; locais: string[] }[] = [];
  let current = error instanceof StartupError ? error.cause : error;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const tipo = ['TypeError', 'RangeError', 'SyntaxError', 'LibsqlError', 'HttpServerError', 'TursoHttpError', 'DomainError', 'Error'].includes(current.name)
      ? current.name : 'Error';
    const rawCode = 'code' in current ? current.code : undefined;
    const codigo = typeof rawCode === 'string' && [
      'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
      'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
      'UNAUTHORIZED', 'FORBIDDEN', 'SERVER_ERROR', 'SQLITE_ERROR',
      'URL_INVALID', 'URL_SCHEME_NOT_SUPPORTED', 'AUTH_TOKEN_INVALID',
    ].includes(rawCode) ? rawCode : undefined;
    const rawStatus = 'status' in current ? current.status : undefined;
    const statusHttp = typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus : undefined;
    const locais = (current.stack ?? '').split('\n').filter(line => /^\s+at /.test(line))
      .flatMap(line => {
        // Only code shipped with the application or Node internals, never a
        // remote URL or the first line of the stack (the error message).
        const match = line.match(/(?:\/var\/task\/|file:\/\/\/var\/task\/|node:)([^\s()?]+:\d+:\d+)\)?$/);
        return match ? [match[1]] : [];
      }).slice(0, 8);
    causas.push({ tipo, ...(codigo ? { codigo } : {}), ...(statusHttp ? { statusHttp } : {}),
      ...(current instanceof TursoHttpError ? { motivo: current.reason, formatoToken: current.tokenFormat, mensagemServidor: current.serverMessage } : {}), locais });
    current = current.cause;
  }
  return { etapa, causas };
}
