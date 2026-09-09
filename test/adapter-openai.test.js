'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openAICompatible } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

test('openai adapter: non-streaming chat proxies content and usage', async () => {
  const upstream = await openAICompatible({ content: 'Answer 42' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, transport: 'openai-compatible' });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].message.content, 'Answer 42');
    assert.equal(json.usage.total_tokens, 15);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('openai adapter: injects the custom system prompt (replace mode)', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({
    baseURL: `${upstream.url}/v1`,
    prompt: 'SYSTEM-PROMPT-MARKER',
  });
  try {
    await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const chat = upstream.requests.find((r) => r.url.includes('/chat/completions'));
    const system = chat.body.messages.find((m) => m.role === 'system');
    assert.ok(system, 'expected a system message');
    assert.match(system.content, /SYSTEM-PROMPT-MARKER/);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('openai adapter: forwards auth header to upstream', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, apiKey: 'sk-secret-xyz-987654' });
  try {
    await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const chat = upstream.requests.find((r) => r.url.includes('/chat/completions'));
    assert.match(chat.headers.authorization || '', /^Bearer sk-secret-xyz-987654$/);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('openai adapter: streaming passes through SSE chunks', async () => {
  const upstream = await openAICompatible({ content: 'streamed' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /data:/);
    assert.match(text, /streamed/);
    assert.match(text, /\[DONE\]/);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('openai adapter: tool calls are returned', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'call a tool' }],
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }],
      }),
    });
    const json = await res.json();
    assert.equal(json.choices[0].finish_reason, 'tool_calls');
    assert.equal(json.choices[0].message.tool_calls[0].function.name, 'get_weather');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('openai adapter: models endpoint proxies list', async () => {
  const upstream = await openAICompatible({ models: [{ id: 'm1' }, { id: 'm2' }] });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/models`);
    assert.equal(res.status, 200);
    const json = await res.json();
    const ids = json.data.map((m) => m.id);
    assert.deepEqual(ids, ['m1', 'm2']);
  } finally {
    await gw.close();
    await upstream.close();
  }
});
