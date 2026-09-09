'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ollamaNative } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

test('ollama adapter: NDJSON stream is translated to OpenAI non-streaming', async () => {
  const upstream = await ollamaNative({ content: 'Hello world from ollama' });
  const gw = await startGateway({ baseURL: upstream.url, transport: 'ollama-native' });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.object, 'chat.completion');
    assert.equal(json.choices[0].message.content, 'Hello world from ollama');
    // Usage mapped from prompt_eval_count/eval_count.
    assert.equal(json.usage.prompt_tokens, 8);
    assert.equal(json.usage.completion_tokens, 4);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('ollama adapter: streaming request yields OpenAI SSE chunks', async () => {
  const upstream = await ollamaNative({ content: 'chunked reply' });
  const gw = await startGateway({ baseURL: upstream.url, transport: 'ollama-native' });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /data:/);
    assert.match(text, /chunked reply|chunked|reply/);
    assert.match(text, /\[DONE\]/);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('ollama adapter: forwards model and system prompt to /api/chat', async () => {
  const upstream = await ollamaNative();
  const gw = await startGateway({
    baseURL: upstream.url,
    transport: 'ollama-native',
    prompt: 'OLLAMA-SYSTEM-MARKER',
  });
  try {
    await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const chat = upstream.requests.find((r) => r.url.includes('/api/chat'));
    assert.ok(chat, 'expected an /api/chat call');
    assert.equal(chat.body.model, 'llama3');
    const system = (chat.body.messages || []).find((m) => m.role === 'system');
    assert.ok(system && /OLLAMA-SYSTEM-MARKER/.test(system.content));
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('ollama adapter: models endpoint returns the provider list', async () => {
  const upstream = await ollamaNative({ models: [{ id: 'llama3' }, { id: 'qwen' }] });
  const gw = await startGateway({ baseURL: upstream.url, transport: 'ollama-native' });
  try {
    const res = await fetch(`${gw.url}/v1/models`);
    assert.equal(res.status, 200);
    const json = await res.json();
    const ids = (json.data || []).map((m) => m.id);
    assert.ok(ids.includes('llama3'));
  } finally {
    await gw.close();
    await upstream.close();
  }
});
