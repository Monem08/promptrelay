'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openAICompatible } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

const FAST_RETRY = { enabled: true, maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20, retryableStatus: [429, 502, 503, 504] };

test('health endpoint reports ok and never leaks the API key', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, apiKey: 'sk-topsecret-abcdef123456' });
  try {
    const res = await fetch(`${gw.url}/health`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('sk-topsecret-abcdef123456'), 'API key must not appear in /health');
    const json = JSON.parse(text);
    assert.equal(json.status, 'ok');
    assert.equal(json.version, require('../package.json').version);
    assert.equal(json.provider.apiKeyConfigured, true);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('chat rejects a request with no messages array (400)', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('retry recovers after transient 503 responses', async () => {
  const upstream = await openAICompatible({ failTimes: 2, failStatus: 503, content: 'recovered' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, config: { retry: FAST_RETRY } });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].message.content, 'recovered');
    const chatCalls = upstream.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatCalls.length, 3, 'expected 2 failures + 1 success');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('retry honors Retry-After header on 429', async () => {
  const upstream = await openAICompatible({ failTimes: 1, failStatus: 429, retryAfter: 0, content: 'ok-after-429' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, config: { retry: FAST_RETRY } });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].message.content, 'ok-after-429');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('non-retryable 400 is forwarded without retrying', async () => {
  const upstream = await openAICompatible({ failTimes: 5, failStatus: 400 });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, config: { retry: FAST_RETRY } });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 400);
    const chatCalls = upstream.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatCalls.length, 1, 'must not retry a 400');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('explicit fallback routes to a backup provider on connection failure', async () => {
  // Working backup upstream.
  const backup = await openAICompatible({ content: 'from-backup' });

  // Dead primary: start then immediately close to get a guaranteed-closed port.
  const dead = await openAICompatible();
  const deadURL = `${dead.url}/v1`;
  await dead.close();

  const gw = await startGateway({
    baseURL: deadURL,
    config: {
      retry: { enabled: true, maxRetries: 0 },
      providers: {
        backup: {
          name: 'Backup',
          transport: 'openai-compatible',
          baseURL: `${backup.url}/v1`,
          model: 'mock-model',
          apiKeyEnv: 'PROVIDER_API_KEY',
          auth: { type: 'bearer' },
          headers: {},
        },
      },
      fallback: { enabled: true, providers: ['backup'] },
    },
  });
  try {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].message.content, 'from-backup');
  } finally {
    await gw.close();
    await backup.close();
  }
});
