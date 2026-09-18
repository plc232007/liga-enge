import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client/http';
import { tursoFetch } from '../src/server/turso-fetch.js';
import { StartupError, startupDiagnostic } from '../src/server/startup-error.js';

test('cliente remoto distingue recusa do JWT sem expor resposta ou credenciais', async () => {
  for (const [message, reason] of [
    ['JWT error: InvalidToken', 'token-invalido'],
    ['JWT error: ExpiredSignature', 'token-expirado'],
    ['JWT error: InvalidSignature', 'assinatura-invalida'],
    ['unknown variant sequence', 'protocolo-incompativel'],
    ['falha desconhecida', 'requisicao-recusada'],
  ]) {
    const token = 'cabecalhoPrivado.conteudoPrivado.assinaturaPrivada';
    const client = createClient({ url: 'https://banco.example', authToken: token,
      fetch: tursoFetch(token, async () => new Response(JSON.stringify({ error: message, private: token }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })),
    });
    try {
      await assert.rejects(client.executeMultiple('PRAGMA foreign_keys = ON;'), error => {
        const diagnostic = startupDiagnostic(new StartupError('conexao-banco', error));
        assert.equal(diagnostic.causas[0].statusHttp, 400);
        assert.equal(diagnostic.causas[0].motivo, reason);
        assert.equal(diagnostic.causas[0].formatoToken, 'formato-jwt');
        assert.doesNotMatch(JSON.stringify(diagnostic), /Privad|banco\.example|JWT error|unknown variant/);
        return true;
      });
    } finally { client.close(); }
  }
});

test('diagnóstico identifica erros de cópia do token sem registrar seu valor', async () => {
  for (const [token, format] of [
    ['libsql://banco-privado.turso.io', 'endereco-no-lugar-do-token'],
    ['Bearer segredo', 'prefixo-bearer'],
    ['"segredo"', 'aspas'],
    ['segredo\n', 'espacos-ou-quebras-de-linha'],
    ['segredo', 'formato-invalido'],
  ]) {
    await assert.rejects(tursoFetch(token, async () => new Response('{}', { status: 400 }))('https://banco.example'), error => {
      const diagnostic = startupDiagnostic(error);
      assert.equal(diagnostic.causas[0].formatoToken, format);
      assert.doesNotMatch(JSON.stringify(diagnostic), /segredo|banco-privado/);
      return true;
    });
  }
});

test('transporte preserva requisição, resposta de sucesso e erros de rede', async () => {
  const response = new Response('{"results":[]}');
  const request = new Request('https://banco.example', { method: 'POST', body: 'consulta', headers: { authorization: 'Bearer segredo' } });
  const wrapped = tursoFetch('segredo', async input => { assert.equal(input, request); return response; });
  assert.equal(await wrapped(request), response);
  assert.equal(await response.text(), '{"results":[]}');
  const networkError = new TypeError('fetch failed');
  await assert.rejects(tursoFetch('segredo', async () => { throw networkError; })(request), error => error === networkError);
});
