import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url))('esbuild');
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../artifacts/api-server/src/puente/model.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { answer, modelConfig, modelConfigured } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('Groq uses its own endpoint and preserves review proposals without executing them', async () => {
  const names = ['GROQ_API_KEY', 'GROQ_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL'];
  const before = Object.fromEntries(names.map(n => [n, process.env[n]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const n of names) delete process.env[n];
    process.env.OPENAI_API_KEY = 'gsk_test_placeholder_not_a_real_key';
    assert.equal(modelConfigured(), true);
    assert.equal(modelConfig().model, 'openai/gpt-oss-120b');
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'openai/gpt-oss-120b');
      assert.equal('store' in body, false);
      assert.equal(body.tools[0].name, 'propose_local_review');
      return new Response(JSON.stringify({ output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'private reasoning' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Here is your draft.' }] },
        { type: 'function_call', name: 'propose_local_review', arguments: JSON.stringify({text: 'Hola, mi amor.', reason: 'Check local phrasing.'}) }
      ] }), {status: 200});
    };
    const result = await answer([{role:'user', content:'Write a letter.', at:''}]);
    assert.equal(result.reply, 'Here is your draft.');
    assert.equal(result.offer.text, 'Hola, mi amor.');
    process.env.GROQ_API_KEY = 'test-explicit-groq-key';
    assert.equal(modelConfig().apiKey, 'test-explicit-groq-key');
    delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_MODEL = 'test-model';
    assert.equal(modelConfig().endpoint, 'https://api.openai.com/v1/responses');
  } finally {
    globalThis.fetch = originalFetch;
    for (const n of names) {
      if (before[n] === undefined) delete process.env[n];
      else process.env[n] = before[n];
    }
  }
});
