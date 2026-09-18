import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/server/runtime.js';
import { StartupError, startupDiagnostic } from '../src/server/startup-error.js';
import { createClient } from '@libsql/client/http';

test('diagnóstico diferencia origem inválida de configuração ausente do banco', async () => {
  await assert.rejects(createRuntime({ VERCEL: '1', APP_ORIGIN: 'liga-enge.vercel.app' }), error => {
    const diagnostic = startupDiagnostic(error);
    assert.equal(diagnostic.etapa, 'origem');
    assert.equal(diagnostic.causas[0].codigo, 'ERR_INVALID_URL');
    return true;
  });
  await assert.rejects(createRuntime({ VERCEL: '1', APP_ORIGIN: 'https://liga-enge.vercel.app' }), error => {
    assert.equal(startupDiagnostic(error).etapa, 'configuracao-banco');
    return true;
  });
});

test('diagnóstico distingue respostas HTTP do Turso usando o cliente remoto', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const client = createClient({
      url: 'https://banco.example', authToken: 'token-privado',
      fetch: async () => new Response(JSON.stringify({ error: 'resposta-privada' }), {
        status, headers: { 'Content-Type': 'application/json' },
      }),
    });
    try {
      await assert.rejects(client.executeMultiple('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'), error => {
        const diagnostic = startupDiagnostic(new StartupError('conexao-banco', error));
        assert.equal(diagnostic.causas[0].codigo, 'SERVER_ERROR');
        assert.equal(diagnostic.causas[1].tipo, 'HttpServerError');
        assert.equal(diagnostic.causas[1].statusHttp, status);
        assert.doesNotMatch(JSON.stringify(diagnostic), /token-privado|resposta-privada|banco\.example/);
        return true;
      });
    } finally { client.close(); }
  }
  for (const status of ['segredo', 401.5, 200, 999, NaN]) {
    const error = Object.assign(new Error('privado'), { status });
    assert.equal(startupDiagnostic(error).causas[0].statusHttp, undefined);
  }
});

test('diagnóstico preserva localização e causa sem registrar valores privados', () => {
  const cause = Object.assign(new Error('token=segredo-nao-publicar'), { code: 'ENOTFOUND' });
  const error = Object.assign(new TypeError('https://usuario:senha@banco.example?token=segredo'), {
    input: 'credencial-privada', cause,
    stack: 'TypeError: https://usuario:senha@banco.example?token=segredo\n' +
      '    at new HttpClient (file:///var/task/node_modules/@libsql/client/lib-esm/http.js:64:38)\n' +
      '    at open (https://banco.example/segredo.js:1:2)\n' +
      '    at new URL (node:internal/url:825:25)',
  });
  const diagnostic = startupDiagnostic(new StartupError('conexao-banco', error));
  assert.equal(diagnostic.etapa, 'conexao-banco');
  assert.equal(diagnostic.causas[0].tipo, 'TypeError');
  assert.deepEqual(diagnostic.causas[0].locais, ['node_modules/@libsql/client/lib-esm/http.js:64:38', 'internal/url:825:25']);
  assert.equal(diagnostic.causas[1].codigo, 'ENOTFOUND');
  assert.doesNotMatch(JSON.stringify(diagnostic), /segredo|senha|credencial|banco\.example/);
  assert.deepEqual(startupDiagnostic('segredo'), { etapa: 'requisicao', causas: [] });
});
