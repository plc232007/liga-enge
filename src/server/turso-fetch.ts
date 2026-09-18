export type TursoReason = 'token-invalido' | 'token-expirado' | 'assinatura-invalida' | 'token-ausente'
  | 'token-audiencia-invalida' | 'token-algoritmo-invalido' | 'protocolo-incompativel' | 'requisicao-recusada';

export class TursoHttpError extends Error {
  constructor(public readonly status: number, public readonly reason: TursoReason, public readonly tokenFormat: string,
    public readonly serverMessage: string) {
    super('O servidor do banco recusou a requisição.');
    this.name = 'TursoHttpError';
  }
}

function safeServerMessage(body: string, token: string | undefined, input: Parameters<typeof fetch>[0]) {
  let message = body;
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== 'object') return 'Resposta sem mensagem de erro textual.';
    const record = data as Record<string, unknown>;
    const detail = record.error ?? record.message ?? record.detail;
    message = typeof detail === 'string' ? detail
      : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
        ? detail.message : 'Resposta sem mensagem de erro textual.';
  } catch {
    if (/^\s*[<{[]/.test(body)) return 'Resposta não textual ou incompleta.';
  }
  // Redact before truncation so a long credential cannot leak a visible prefix.
  if (token) {
    for (const secret of [token, ...token.split('.').filter(part => part.length > 8)]) {
      message = message.split(secret).join('[oculto]');
    }
  }
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    message = message.split(url.host).join('[servidor]');
  } catch { /* Do not include malformed request URLs. */ }
  return message
    .replace(/(?:https?|libsql):\/\/[^\s"'<>]+/gi, '[endereco]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [oculto]')
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[oculto]')
    .replace(/\b[A-Za-z0-9_+\/-]{32,}={0,2}/g, '[oculto]')
    .replace(/(["'])(?:(?!\1)[^\r\n])*?\1/g, '[valor]')
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 600);
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
    // Read a bounded error body; retain classifications and a redacted message.
    // Never attach the raw response, headers, URL or token to the error.
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
    throw new TursoHttpError(response.status, reasonFromBody(body), tokenFormat(authToken), safeServerMessage(body, authToken, input));
  };
}
