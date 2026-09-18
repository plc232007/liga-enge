export type TursoReason = 'token-invalido' | 'token-expirado' | 'assinatura-invalida' | 'token-ausente'
  | 'token-audiencia-invalida' | 'token-algoritmo-invalido' | 'protocolo-incompativel' | 'requisicao-recusada';

export class TursoHttpError extends Error {
  constructor(public readonly status: number, public readonly reason: TursoReason, public readonly tokenFormat: string) {
    super('O servidor do banco recusou a requisição.');
    this.name = 'TursoHttpError';
  }
}

function tokenFormat(token: string | undefined) {
  if (!token) return 'ausente';
  if (/^(libsql|https?):\/\//i.test(token.trim())) return 'endereco-no-lugar-do-token';
  if (/^Bearer\s/i.test(token)) return 'prefixo-bearer';
  if (/^["']|["']$/.test(token)) return 'aspas';
  if (/\s/.test(token)) return 'espacos-ou-quebras-de-linha';
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? 'formato-jwt' : 'formato-invalido';
}

function reasonFromBody(body: string): TursoReason {
  if (/ExpiredSignature|token.{0,30}expired/i.test(body)) return 'token-expirado';
  if (/InvalidSignature/i.test(body)) return 'assinatura-invalida';
  if (/InvalidAudience/i.test(body)) return 'token-audiencia-invalida';
  if (/InvalidAlgorithm/i.test(body)) return 'token-algoritmo-invalido';
  if (/empty JWT token|missing.{0,20}token/i.test(body)) return 'token-ausente';
  if (/JWT error|InvalidToken/i.test(body)) return 'token-invalido';
  if (/unknown variant|unsupported request|malformed request|protocol violation/i.test(body)) return 'protocolo-incompativel';
  return 'requisicao-recusada';
}

export function tursoFetch(authToken?: string, fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.ok) return response;
    // Read a bounded error body and retain only fixed classifications. Never
    // attach the raw response, request headers, URL or token to the error.
    let body = '';
    const reader = response.body?.getReader();
    if (reader) {
      try {
        const decoder = new TextDecoder();
        let bytes = 0;
        while (bytes < 4096) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, 4096 - bytes);
          body += decoder.decode(chunk, { stream: true });
          bytes += chunk.length;
        }
      } catch { /* The HTTP status remains useful if reading the body fails. */ }
      finally { await reader.cancel().catch(() => undefined); }
    }
    throw new TursoHttpError(response.status, reasonFromBody(body), tokenFormat(authToken));
  };
}
