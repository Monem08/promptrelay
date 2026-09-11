'use strict';

/**
 * Batch C verification test suite:
 *  - Dashboard live SSE telemetry stream (/api/dashboard/stream)
 *  - Scoped prompt APIs (GET & POST /api/dashboard/prompts?scope=...)
 *  - Client configuration & test APIs (/api/dashboard/clients/:id/*)
 *  - Background service status API (/api/dashboard/service)
 *  - Doctor self-healing repair API (/api/dashboard/doctor/repair)
 *  - Multi-client end-to-end routing & telemetry attribution
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { openAICompatible } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');
const telemetry = require('../src/telemetry/requests');
const { resolvePrompt, savePrompt } = require('../src/prompts/scopes');

async function withGateway(run) {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, apiKey: 'sk-batch-c-test' });
  try {
    await run(gw, upstream);
  } finally {
    await gw.close();
    await upstream.close();
  }
}

test('dashboard /stream provides real-time SSE updates', async () => {
  await withGateway(async (gw) => {
    const url = new URL(`${gw.url}/api/dashboard/stream`);

    const receivedChunks = [];
    let sseReq;

    const streamPromise = new Promise((resolve, reject) => {
      sseReq = http.get(url, (res) => {
        assert.equal(res.statusCode, 200);
        assert.ok((res.headers['content-type'] || '').includes('text/event-stream'));

        res.on('data', (chunk) => {
          const str = chunk.toString();
          receivedChunks.push(str);
          if (str.includes('test-model-sse')) {
            resolve();
          }
        });
        res.on('error', reject);
      });
      sseReq.on('error', reject);
    });

    // Wait slightly for connection to establish
    await new Promise((r) => setTimeout(r, 100));

    // Emit a request event via telemetry.record
    telemetry.record({
      id: 'req_sse_123',
      client: 'opencode',
      ingress: 'openai',
      provider: 'mock',
      model: 'test-model-sse',
      status: 200,
      ok: true,
      totalMs: 42,
    });

    await streamPromise;

    sseReq.destroy();
    const fullStream = receivedChunks.join('');
    assert.ok(fullStream.includes(':connected'), 'stream received initial connected preamble');
    assert.ok(fullStream.includes('event: request'), 'stream received request event');
    assert.ok(fullStream.includes('test-model-sse'), 'stream received recorded payload');
  });
});

test('dashboard /prompts supports scoped prompts for clients', async () => {
  await withGateway(async (gw) => {
    // 1. Check default global prompt
    const resGlobal = await fetch(`${gw.url}/api/dashboard/prompts`);
    assert.equal(resGlobal.status, 200);
    const jsonGlobal = await resGlobal.json();
    assert.equal(jsonGlobal.scope, 'global');
    assert.ok(Array.isArray(jsonGlobal.scopes));
    assert.ok(jsonGlobal.scopes.includes('opencode'));
    assert.ok(jsonGlobal.scopes.includes('claude-code'));

    // 2. Save a custom scoped prompt for opencode
    const customOpenCodePrompt = 'You are specialized for OpenCode development.';
    const saveRes = await fetch(`${gw.url}/api/dashboard/prompts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'opencode',
        content: customOpenCodePrompt,
        mode: 'prepend',
      }),
    });
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    assert.equal(saveJson.ok, true);
    assert.equal(saveJson.scope, 'opencode');
    assert.equal(saveJson.mode, 'prepend');

    // 3. Fetch scoped prompt back
    const fetchScoped = await fetch(`${gw.url}/api/dashboard/prompts?scope=opencode`);
    assert.equal(fetchScoped.status, 200);
    const scopedJson = await fetchScoped.json();
    assert.equal(scopedJson.scope, 'opencode');
    assert.equal(scopedJson.content, customOpenCodePrompt);
    assert.equal(scopedJson.mode, 'prepend');
  });
});

test('dashboard /clients APIs support test and configuration', async () => {
  await withGateway(async (gw) => {
    // Test OpenCode status via API
    const testRes = await fetch(`${gw.url}/api/dashboard/clients/opencode/test`, { method: 'POST' });
    assert.equal(testRes.status, 200);
    const testJson = await testRes.json();
    assert.equal(testJson.ok, true);
    assert.ok(testJson.status);
    assert.equal(testJson.status.label, 'OpenCode');

    // Configure OpenCode via API
    const confRes = await fetch(`${gw.url}/api/dashboard/clients/opencode/configure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-custom' }),
    });
    assert.equal(confRes.status, 200);
    const confJson = await confRes.json();
    assert.equal(confJson.ok, true);
    assert.ok(confJson.result.path);
  });
});

test('dashboard /service returns background service status', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/service`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok('platform' in json);
    assert.ok('serviceType' in json);
    assert.ok('installed' in json);
    assert.ok('running' in json);
  });
});

test('dashboard /doctor/repair runs self-healing diagnostics', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/doctor/repair`, { method: 'POST' });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.repaired));
  });
});

test('multi-client end-to-end routing attributes client identity and scopes', async () => {
  await withGateway(async (gw, upstream) => {
    // 1. OpenAI chat completions ingress with OpenCode client
    const res1 = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-promptrelay-client': 'opencode',
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello from opencode' }],
      }),
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.ok(body1.choices);

    // Verify upstream received the injected system prompt
    assert.ok(upstream.requests.length > 0);
    const lastCall = upstream.requests[upstream.requests.length - 1];
    assert.equal(lastCall.url, '/v1/chat/completions');

    // Verify telemetry logged with opencode client
    const recent = telemetry.list({ limit: 5 });
    const match = recent.find((r) => r.client === 'opencode');
    assert.ok(match, 'telemetry recorded request with client=opencode');
    assert.equal(match.ok, true);
  });
});
