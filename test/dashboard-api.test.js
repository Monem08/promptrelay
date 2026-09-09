'use strict';

/**
 * Dashboard backend API tests.
 *
 * Boots a real PromptRelay gateway (via the shared harness) against a mock
 * upstream and exercises every /api/dashboard/* endpoint. The overriding
 * concern here is security: the dashboard must never echo the configured API
 * key, and it must serve the SPA + JSON with sanitized errors.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { openAICompatible } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

const SECRET = 'sk-dashboard-topsecret-should-never-leak-9876543210';

// Every GET endpoint the SPA relies on. Each must answer 200 and never leak.
const GET_ENDPOINTS = [
  '/api/dashboard/status',
  '/api/dashboard/clients',
  '/api/dashboard/providers',
  '/api/dashboard/models',
  '/api/dashboard/router',
  '/api/dashboard/prompts',
  '/api/dashboard/requests',
  '/api/dashboard/metrics',
  '/api/dashboard/diagnostics',
  '/api/dashboard/settings',
];

async function withGateway(run) {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, apiKey: SECRET });
  try {
    await run(gw, upstream);
  } finally {
    await gw.close();
    await upstream.close();
  }
}

test('every dashboard GET endpoint returns 200 JSON', async () => {
  await withGateway(async (gw) => {
    for (const ep of GET_ENDPOINTS) {
      const res = await fetch(`${gw.url}${ep}`);
      assert.equal(res.status, 200, `${ep} should return 200`);
      const ct = res.headers.get('content-type') || '';
      assert.ok(ct.includes('application/json'), `${ep} should return JSON`);
      await res.json(); // must parse
    }
  });
});

test('no dashboard endpoint leaks the configured API key', async () => {
  await withGateway(async (gw) => {
    for (const ep of GET_ENDPOINTS) {
      const res = await fetch(`${gw.url}${ep}`);
      const text = await res.text();
      assert.ok(!text.includes(SECRET), `${ep} must not contain the raw API key`);
      // Also guard against leaking the env var *value* under any JSON key.
      assert.ok(!text.toLowerCase().includes('topsecret'), `${ep} must not contain secret fragments`);
    }
  });
});

test('providers endpoint masks credentials rather than exposing them', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/providers`);
    const json = await res.json();
    assert.ok(Array.isArray(json.providers), 'providers array present');
    for (const p of json.providers) {
      if (p.apiKeyMasked) {
        assert.ok(!p.apiKeyMasked.includes(SECRET), 'masked key must not equal the real key');
      }
    }
    const raw = JSON.stringify(json);
    assert.ok(!raw.includes(SECRET), 'providers payload must not include the raw key');
  });
});

test('POST /provider does not echo the submitted API key back', async () => {
  await withGateway(async (gw) => {
    const submitted = 'sk-submitted-secret-abcdef1234567890';
    const res = await fetch(`${gw.url}/api/dashboard/provider`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Provider', preset: 'openai', apiKey: submitted }),
    });
    const text = await res.text();
    assert.ok(!text.includes(submitted), 'response must not echo the submitted key');
  });
});

test('unknown request id returns a sanitized 404', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/requests/does-not-exist`);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.ok(!text.includes(SECRET), '404 body must not leak secrets');
    // Sanitized error: should not include a raw stack trace / file paths.
    assert.ok(!/\bat \/.*\.js:\d+/.test(text), 'error body must not contain a stack trace');
  });
});

test('settings endpoint reports local-only by default', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/settings`);
    const json = await res.json();
    assert.ok(json.dashboard, 'settings.dashboard present');
    assert.equal(json.dashboard.remoteAccessAllowed, false, 'remote access disabled by default');
  });
});

test('dashboard SPA shell is served at /dashboard/', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/dashboard/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<div id="app"'), 'SPA root element present');
    assert.ok(/type="module"/.test(html), 'ES module bootstrap present');
  });
});

test('metrics endpoint exposes a stable shape even with no data', async () => {
  await withGateway(async (gw) => {
    const res = await fetch(`${gw.url}/api/dashboard/metrics`);
    const json = await res.json();
    assert.equal(typeof json.total, 'number');
    assert.equal(typeof json.hasData, 'boolean');
    assert.ok('successRate' in json);
    assert.ok(Array.isArray(json.byProvider));
  });
});
