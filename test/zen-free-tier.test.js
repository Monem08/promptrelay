'use strict';

/**
 * OpenCode Zen free-tier support.
 *
 * The relay only serves its free models to requests that carry an OpenCode
 * User-Agent and a stable `x-opencode-session`. These tests pin that behaviour
 * at the unit level (header construction, session stability, eviction, opt-in
 * gating, operator override precedence) and at the gateway level (the injected
 * headers actually reach upstream, and a request from a plain HTTP client
 * succeeds where it would otherwise be rejected).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const zen = require('../src/providers/zen-free-tier');
const { providerHeaders, requestContext } = require('../src/providers/http');
const { getPreset } = require('../src/providers/presets');
const { validateConfig } = require('../src/config');
const { createApp } = require('../src/server/app');

function zenConfig(overrides = {}) {
  return {
    provider: {
      name: 'OpenCode Zen',
      transport: 'openai-compatible',
      baseURL: 'https://opencode.ai/zen/v1',
      model: 'space-bunny-free',
      auth: { type: 'none' },
      headers: {},
      zenFreeTier: { enabled: true },
      ...overrides,
    },
    reasoning: { default: 'high', injectDefault: false },
  };
}

describe('zen-free-tier: opt-in gating', () => {
  beforeEach(() => zen._reset());
  afterEach(() => zen._reset());

  it('injects nothing when zenFreeTier is absent (default config)', () => {
    const headers = providerHeaders({ provider: { headers: {} } });
    assert.equal(headers['User-Agent'], undefined);
    assert.equal(headers['x-opencode-session'], undefined);
  });

  it('injects nothing when explicitly disabled', () => {
    const headers = providerHeaders({ provider: { headers: {}, zenFreeTier: { enabled: false } } });
    assert.equal(headers['x-opencode-session'], undefined);
  });

  it('injects nothing for providers that never opted in', () => {
    const headers = providerHeaders({ provider: { name: 'OpenRouter', headers: {} } });
    assert.equal(headers['x-opencode-session'], undefined);
  });

  it('accepts the boolean shorthand', () => {
    assert.equal(zen.isEnabled({ zenFreeTier: true }), true);
    assert.equal(zen.isEnabled({ zenFreeTier: false }), false);
    assert.equal(zen.isEnabled({}), false);
  });
});

describe('zen-free-tier: header construction', () => {
  beforeEach(() => zen._reset());
  afterEach(() => zen._reset());

  it('sends an opencode User-Agent and a relay-shaped session id', () => {
    const headers = providerHeaders(zenConfig());
    assert.match(headers['User-Agent'], /^opencode\/\d+\.\d+\.\d+$/);
    assert.match(headers['x-opencode-session'], /^ses_[0-9a-f]{26}$/);
  });

  it('does not send an Authorization header when no key is configured', () => {
    const headers = providerHeaders(zenConfig());
    assert.equal(headers.Authorization, undefined, 'anonymous free tier must not require a key');
  });

  it('still sends the configured key when one is present (BYOK)', () => {
    // A key is only sent when the provider's auth style asks for one; with
    // auth.type "none" the operator has explicitly opted out of credentials.
    const config = zenConfig({ auth: { type: 'bearer' }, apiKey: 'oc_sk_test' });
    const headers = providerHeaders(config);
    assert.equal(headers.Authorization, 'Bearer oc_sk_test');
    assert.match(headers['x-opencode-session'], /^ses_/);
  });

  it('sends no Authorization header when auth.type is none even if a key is set', () => {
    const config = zenConfig({ auth: { type: 'none' }, apiKey: 'oc_sk_test' });
    assert.equal(providerHeaders(config).Authorization, undefined);
  });

  it('honors auth.type header for providers using a non-bearer key', () => {
    const config = zenConfig({ apiKey: 'secret', auth: { type: 'header', headerName: 'x-api-key' } });
    const headers = providerHeaders(config);
    assert.equal(headers['x-api-key'], 'secret');
    assert.equal(headers.Authorization, undefined);
  });

  it('lets an operator-configured User-Agent win over the injected one', () => {
    const config = zenConfig({ headers: { 'User-Agent': 'my-proxy/9.9' } });
    const headers = providerHeaders(config);
    assert.equal(headers['User-Agent'], 'my-proxy/9.9');
  });

  it('honors a configured userAgent override', () => {
    const config = zenConfig({ zenFreeTier: { enabled: true, userAgent: 'opencode/9.9.9' } });
    assert.equal(providerHeaders(config)['User-Agent'], 'opencode/9.9.9');
  });

  it('omits the session header when injectSession is false', () => {
    const config = zenConfig({ zenFreeTier: { enabled: true, injectSession: false } });
    const headers = providerHeaders(config);
    assert.equal(headers['x-opencode-session'], undefined);
    assert.match(headers['User-Agent'], /^opencode\//);
  });

  it('does not mutate the config headers object', () => {
    const config = zenConfig();
    providerHeaders(config);
    assert.deepEqual(config.provider.headers, {});
  });

  it('preserves unrelated operator headers', () => {
    const config = zenConfig({ headers: { 'X-Title': 'PromptRelay' } });
    const headers = providerHeaders(config);
    assert.equal(headers['X-Title'], 'PromptRelay');
    assert.equal(headers['Content-Type'], 'application/json');
  });
});

describe('zen-free-tier: session stability', () => {
  beforeEach(() => zen._reset());
  afterEach(() => zen._reset());

  it('returns the same id for repeated requests from one client', () => {
    const first = zen.sessionFor({ clientId: 'hermes' });
    const second = zen.sessionFor({ clientId: 'hermes' });
    assert.equal(first, second, 'prompt-cache affinity requires a stable id');
  });

  it('gives distinct clients distinct ids', () => {
    assert.notEqual(zen.sessionFor({ clientId: 'hermes' }), zen.sessionFor({ clientId: 'opencode' }));
  });

  it('falls back to the peer address when the client is unknown', () => {
    const a = zen.sessionFor({ clientId: 'unknown', ip: '10.0.0.5' });
    const b = zen.sessionFor({ clientId: '', ip: '10.0.0.5' });
    const c = zen.sessionFor({ clientId: '', ip: '10.0.0.6' });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('shares one key when there is no request context at all', () => {
    assert.equal(zen.sessionFor(), zen.sessionFor({}));
  });

  it('never reuses an id across distinct clients', () => {
    const ids = new Set(['opencode', 'claude-code', 'hermes'].map((c) => zen.sessionFor({ clientId: c })));
    assert.equal(ids.size, 3);
  });

  it('mints ids matching the OpenCode client shape', () => {
    assert.match(zen.mintSessionId(), /^ses_[0-9a-f]{26}$/);
  });
});

describe('zen-free-tier: eviction', () => {
  beforeEach(() => zen._reset());
  afterEach(() => zen._reset());

  it('bounds the pool so client churn cannot grow memory without limit', () => {
    for (let i = 0; i < zen.MAX_SESSIONS + 50; i += 1) zen.sessionFor({ clientId: `c${i}` });
    assert.equal(zen.status({ provider: { zenFreeTier: true } }).activeSessions, zen.MAX_SESSIONS);
  });

  it('keeps an actively-used client alive while evicting idle ones', () => {
    // LRU: touching an entry refreshes its position, so a client that keeps
    // making requests survives churn that evicts a client that went quiet.
    const active = zen.sessionFor({ clientId: 'active' });
    const idle = zen.sessionFor({ clientId: 'idle' });

    for (let i = 0; i < zen.MAX_SESSIONS + 50; i += 1) {
      zen.sessionFor({ clientId: `noise${i}` });
      if (i % 10 === 0) zen.sessionFor({ clientId: 'active' });
    }

    assert.equal(zen.sessionFor({ clientId: 'active' }), active, 'an active client must keep its session');
    assert.notEqual(zen.sessionFor({ clientId: 'idle' }), idle, 'an idle client is the eviction victim');
  });

  it('re-mints once the entry has been idle past the TTL', () => {
    // Expiry is measured from the LAST touch, not from creation — a long-lived
    // conversation that keeps sending requests must never lose its session.
    const t0 = 1_000_000;
    const first = zen.sessionFor({ clientId: 'hermes' }, { now: t0 });
    assert.equal(zen.sessionFor({ clientId: 'hermes' }, { now: t0 + 1000 }), first);

    // Still alive just under the TTL measured from that last touch.
    const stillFresh = t0 + 1000 + zen.DEFAULT_SESSION_TTL_MS - 1;
    assert.equal(zen.sessionFor({ clientId: 'hermes' }, { now: stillFresh }), first);

    const later = zen.sessionFor({ clientId: 'hermes' }, { now: stillFresh + zen.DEFAULT_SESSION_TTL_MS + 1 });
    assert.notEqual(first, later, 'an entry idle past the TTL must be re-minted');
  });
});

describe('zen-free-tier: status', () => {
  beforeEach(() => zen._reset());
  afterEach(() => zen._reset());

  it('reports enabled state without exposing the session id', () => {
    zen.sessionFor({ clientId: 'hermes' });
    const status = zen.status(zenConfig());
    assert.equal(status.enabled, true);
    assert.equal(status.sessionHeader, 'x-opencode-session');
    assert.equal(status.activeSessions, 1);
    assert.equal(status.mintedSessions, 1);
    assert.equal(JSON.stringify(status).includes('ses_'), false, 'status must not leak session ids');
  });

  it('reports disabled for providers that never opted in', () => {
    const status = zen.status({ provider: { headers: {} } });
    assert.equal(status.enabled, false);
    assert.equal(status.userAgent, null);
  });
});

describe('zen-free-tier: request context', () => {
  it('prefers the explicit PromptRelay client header', () => {
    const ctx = requestContext({ headers: { 'x-promptrelay-client': 'Hermes' }, ip: '10.0.0.9' });
    assert.equal(ctx.clientId, 'Hermes');
    assert.equal(zen.poolKey(ctx), 'client:Hermes');
  });

  it('falls back to the peer address', () => {
    const ctx = requestContext({ headers: {}, ip: '10.0.0.9' });
    assert.equal(zen.poolKey(ctx), 'ip:10.0.0.9');
  });

  it('tolerates a missing request', () => {
    assert.equal(zen.poolKey(requestContext(undefined)), 'server');
    assert.equal(zen.poolKey(requestContext({})), 'server');
  });
});

describe('zen-free-tier: preset + validation', () => {
  it('the opencode-zen preset opts in and no longer demands a key', () => {
    const preset = getPreset('opencode-zen');
    assert.deepEqual(preset.provider.zenFreeTier, { enabled: true });
    assert.equal(preset.needsKey, false, 'the free tier works anonymously');
  });

  it('leaves every other preset opted out', () => {
    for (const id of ['openrouter', 'anthropic', 'openai', 'custom-openai']) {
      const preset = getPreset(id);
      const flag = preset.provider.zenFreeTier;
      const enabled = flag === true || (flag && flag.enabled === true);
      assert.equal(Boolean(enabled), false, `${id} must not opt in`);
    }
  });

  it('accepts valid zenFreeTier shapes', () => {
    const base = {
      provider: { baseURL: 'https://opencode.ai/zen/v1', model: 'space-bunny-free', transport: 'openai-compatible', auth: { type: 'none' } },
      prompt: { mode: 'replace' },
      server: { port: 4141 },
    };
    for (const value of [true, false, { enabled: true }, { enabled: true, injectSession: false }, { userAgent: 'opencode/1.2.3' }]) {
      const problems = validateConfig({ ...base, provider: { ...base.provider, zenFreeTier: value } });
      assert.deepEqual(problems, [], `unexpected problems for ${JSON.stringify(value)}`);
    }
  });

  it('rejects malformed zenFreeTier values', () => {
    const base = {
      provider: { baseURL: 'https://x.dev/v1', model: 'm', transport: 'openai-compatible', auth: { type: 'none' } },
      prompt: { mode: 'replace' },
      server: { port: 4141 },
    };
    const bad = [
      ['zenFreeTier', 'yes'],
      ['zenFreeTier', ['a']],
    ];
    for (const [, value] of bad) {
      const problems = validateConfig({ ...base, provider: { ...base.provider, zenFreeTier: value } });
      assert.ok(problems.some((p) => p.includes('zenFreeTier')), `expected a problem for ${JSON.stringify(value)}`);
    }

    const enabledBad = validateConfig({ ...base, provider: { ...base.provider, zenFreeTier: { enabled: 'yes' } } });
    assert.ok(enabledBad.some((p) => p.includes('zenFreeTier.enabled')));

    const uaBad = validateConfig({ ...base, provider: { ...base.provider, zenFreeTier: { userAgent: '  ' } } });
    assert.ok(uaBad.some((p) => p.includes('zenFreeTier.userAgent')));
  });
});

describe('zen-free-tier: gateway end-to-end', () => {
  let tmpDir;
  let savedConfigEnv;
  let upstream;
  let upstreamPort;
  let seen = [];

  beforeEach(async () => {
    zen._reset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-zen-ft-'));
    savedConfigEnv = process.env.PROMPTRELAY_CONFIG;
    seen = [];

    // Stands in for the Zen relay: rejects anything that is not carrying an
    // OpenCode User-Agent and a session id, exactly like the real free tier.
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const ua = String(req.headers['user-agent'] || '');
        const session = String(req.headers['x-opencode-session'] || '');
        seen.push({ url: req.url, ua, session, body: body ? JSON.parse(body) : null });

        const ok = /^opencode\//.test(ua) && /^ses_[0-9a-f]{26}$/.test(session);
        if (!ok) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: { type: 'FreeTierError', message: "OpenCode's free tier can only be used from within OpenCode" },
          }));
          return;
        }

        const parsed = body ? JSON.parse(body) : {};
        if (parsed.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: {"id":"1","choices":[{"delta":{"content":"free "}}]}\n\n`);
          res.write(`data: {"id":"1","choices":[{"delta":{"content":"tier"}}]}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: '1',
          object: 'chat.completion',
          model: 'space-bunny-free',
          choices: [{ index: 0, message: { role: 'assistant', content: 'free tier' }, finish_reason: 'stop' }],
        }));
      });
    });

    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = upstream.address().port;

    const promptFile = path.join(tmpDir, 'system_prompt.txt');
    fs.writeFileSync(promptFile, 'Be helpful.\n', 'utf8');

    const configPath = path.join(tmpDir, 'promptrelay.json');
    fs.writeFileSync(configPath, JSON.stringify({
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile, root: tmpDir },
      prompt: { mode: 'prepend', file: promptFile, placeholder: '<write your system prompt here>' },
      provider: {
        name: 'OpenCode Zen',
        transport: 'openai-compatible',
        baseURL: `http://127.0.0.1:${upstreamPort}/v1`,
        model: 'space-bunny-free',
        forceModel: true,
        auth: { type: 'none' },
        headers: {},
        zenFreeTier: { enabled: true },
      },
      reasoning: { supported: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
      logging: { requests: false },
    }, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = configPath;
  });

  afterEach(async () => {
    if (savedConfigEnv) process.env.PROMPTRELAY_CONFIG = savedConfigEnv;
    else delete process.env.PROMPTRELAY_CONFIG;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (upstream) await new Promise((r) => upstream.close(r));
    zen._reset();
  });

  async function withGateway(fn) {
    const server = http.createServer(createApp());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      return await fn(server.address().port);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it('serves a plain (non-OpenCode) client by injecting the free-tier headers', async () => {
    await withGateway(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'hermes/1.0' },
        body: JSON.stringify({ model: 'space-bunny-free', messages: [{ role: 'user', content: 'hi' }] }),
      });

      assert.equal(res.status, 200, 'the gateway must make the free tier reachable for any client');
      const data = await res.json();
      assert.equal(data.choices[0].message.content, 'free tier');

      assert.equal(seen.length, 1);
      assert.match(seen[0].ua, /^opencode\//, 'upstream must see an OpenCode User-Agent');
      assert.match(seen[0].session, /^ses_[0-9a-f]{26}$/);
      assert.equal(seen[0].body.stream, undefined, 'the body must be passed through unmodified');
    });
  });

  it('keeps one session id stable across a client\'s requests', async () => {
    await withGateway(async (port) => {
      const call = () => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-promptrelay-client': 'hermes' },
        body: JSON.stringify({ model: 'space-bunny-free', messages: [{ role: 'user', content: 'hi' }] }),
      });

      await call();
      await call();
      await call();

      assert.equal(seen.length, 3);
      assert.equal(new Set(seen.map((r) => r.session)).size, 1, 'session affinity must be stable');
    });
  });

  it('isolates sessions per client id', async () => {
    await withGateway(async (port) => {
      const call = (client) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-promptrelay-client': client },
        body: JSON.stringify({ model: 'space-bunny-free', messages: [{ role: 'user', content: 'hi' }] }),
      });

      await call('hermes');
      await call('opencode');
      assert.equal(new Set(seen.map((r) => r.session)).size, 2);
    });
  });

  it('streams through with the injected headers intact', async () => {
    await withGateway(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'space-bunny-free', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/event-stream'));
      const text = await res.text();
      assert.ok(text.includes('free '));
      assert.ok(text.includes('tier'));
      assert.ok(text.includes('[DONE]'));
      assert.equal(seen[0].body.stream, true);
    });
  });

  it('propagates the relay 403 verbatim instead of masking it', async () => {
    // Opting back out must surface the real upstream error, not a silent success.
    const configPath = path.join(tmpDir, 'promptrelay-nooptin.json');
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'promptrelay.json'), 'utf8'));
    raw.provider.zenFreeTier = { enabled: false };
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = configPath;

    await withGateway(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'space-bunny-free', messages: [{ role: 'user', content: 'hi' }] }),
      });

      assert.equal(res.status, 403, 'a non-opted-in provider must not receive injected headers');
      const data = await res.json();
      assert.equal(data.error.type, 'FreeTierError');
    });
  });
});