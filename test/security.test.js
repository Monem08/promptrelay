'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/server/app');
const { dashboardSecurityGuard } = require('../src/server/dashboard');
const { collectSecrets, safeConfig } = require('../src/config');

describe('PromptRelay Security & Hardening', () => {
  describe('Secret Collection & Redaction', () => {
    it('collects and redacts secrets from config and environment', () => {
      process.env.PROMPTRELAY_GATEWAY_KEY = 'secret-gw-token-987';
      process.env.PROMPTRELAY_DASHBOARD_TOKEN = 'secret-dash-token-654';

      const config = {
        provider: {
          apiKey: 'sk-provider-secret-123',
          headers: { 'X-Custom-Secret': 'custom-auth-secret-val' },
        },
        security: {
          dashboardToken: 'token-abc',
          gatewayAuth: { token: 'token-xyz' },
        },
        server: {
          apiKey: 'legacy-key-456',
        },
      };

      const secrets = collectSecrets(config);
      assert.ok(secrets.includes('sk-provider-secret-123'));
      assert.ok(secrets.includes('secret-gw-token-987'));
      assert.ok(secrets.includes('secret-dash-token-654'));
      assert.ok(secrets.includes('token-abc'));
      assert.ok(secrets.includes('token-xyz'));
      assert.ok(secrets.includes('legacy-key-456'));
      assert.ok(secrets.includes('custom-auth-secret-val'));

      delete process.env.PROMPTRELAY_GATEWAY_KEY;
      delete process.env.PROMPTRELAY_DASHBOARD_TOKEN;
    });

    it('safeConfig never leaks raw API keys or tokens', () => {
      const config = {
        version: 3,
        server: { host: '127.0.0.1', port: 4141 },
        prompt: { mode: 'replace', placeholder: '...' },
        provider: {
          name: 'Test',
          transport: 'openai-compatible',
          baseURL: 'http://test',
          model: 'm1',
          apiKey: 'super-sensitive-key-never-leak',
        },
        paths: { configFile: 'cfg.json', promptFile: 'p.txt', envFile: '.env' },
        security: { dashboardToken: 'secret-token' },
      };

      const safe = safeConfig(config);
      const json = JSON.stringify(safe);
      assert.ok(!json.includes('super-sensitive-key-never-leak'));
      assert.ok(!json.includes('secret-token'));
      assert.equal(safe.provider.apiKeyConfigured, true);
    });
  });

  describe('Remote Dashboard Security Guard', () => {
    function makeReq(overrides = {}) {
      return {
        ip: '192.168.1.50',
        headers: {},
        method: 'GET',
        socket: { remoteAddress: '192.168.1.50' },
        ...overrides,
      };
    }

    function makeRes() {
      const headers = {};
      let statusCode = 200;
      let body = null;
      return {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        getHeader: (k) => headers[k.toLowerCase()],
        status: (code) => { statusCode = code; return { json: (data) => { body = data; } }; },
        _getHeaders: () => headers,
        _getStatus: () => statusCode,
        _getBody: () => body,
      };
    }

    it('sets standard security headers on all responses', () => {
      const req = makeReq({ ip: '127.0.0.1' });
      const res = makeRes();
      let nextCalled = false;
      dashboardSecurityGuard(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
      assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
      assert.equal(res.getHeader('x-frame-options'), 'DENY');
      assert.equal(res.getHeader('referrer-policy'), 'no-referrer');
      assert.ok(res.getHeader('content-security-policy'));
    });

    it('warns when remote connection is non-TLS', () => {
      const req = makeReq({ ip: '192.168.1.100', secure: false });
      const res = makeRes();
      dashboardSecurityGuard(req, res, () => {});

      assert.equal(res.getHeader('x-promptrelay-security-warning'), 'non-TLS remote connection');
    });

    it('blocks remote access when PROMPTRELAY_DASHBOARD_ALLOW_REMOTE is false', () => {
      delete process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE;
      const req = makeReq({ ip: '192.168.1.100' });
      const res = makeRes();
      let nextCalled = false;
      dashboardSecurityGuard(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, false);
      assert.equal(res._getStatus(), 403);
      assert.equal(res._getBody().error.type, 'dashboard_local_only');
    });

    it('securely refuses remote access when token is not configured', () => {
      process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE = 'true';
      delete process.env.PROMPTRELAY_DASHBOARD_TOKEN;

      const req = makeReq({ ip: '192.168.1.100' });
      const res = makeRes();
      dashboardSecurityGuard(req, res, () => {});

      assert.equal(res._getStatus(), 403);
      assert.equal(res._getBody().error.type, 'missing_dashboard_token_config');

      delete process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE;
    });

    it('rejects remote requests with missing or invalid token', () => {
      process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE = 'true';
      process.env.PROMPTRELAY_DASHBOARD_TOKEN = 'correct-token-secret-1234';

      // 1. Missing token
      const reqMissing = makeReq({ ip: '192.168.1.100', headers: {} });
      const resMissing = makeRes();
      dashboardSecurityGuard(reqMissing, resMissing, () => {});
      assert.equal(resMissing._getStatus(), 401);
      assert.equal(resMissing._getBody().error.type, 'missing_dashboard_token');

      // 2. Invalid token
      const reqInvalid = makeReq({
        ip: '192.168.1.100',
        headers: { authorization: 'Bearer wrong-token' },
      });
      const resInvalid = makeRes();
      dashboardSecurityGuard(reqInvalid, resInvalid, () => {});
      assert.equal(resInvalid._getStatus(), 401);
      assert.equal(resInvalid._getBody().error.type, 'invalid_dashboard_token');

      // 3. Valid token
      const reqValid = makeReq({
        ip: '192.168.1.100',
        headers: { authorization: 'Bearer correct-token-secret-1234' },
      });
      const resValid = makeRes();
      let passed = false;
      dashboardSecurityGuard(reqValid, resValid, () => { passed = true; });
      assert.equal(passed, true);

      delete process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE;
      delete process.env.PROMPTRELAY_DASHBOARD_TOKEN;
    });

    it('refuses cross-origin state-changing mutations on remote requests', () => {
      process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE = 'true';
      process.env.PROMPTRELAY_DASHBOARD_TOKEN = 'token-123';

      const reqCsrf = makeReq({
        method: 'POST',
        ip: '192.168.1.100',
        headers: {
          authorization: 'Bearer token-123',
          origin: 'http://malicious-site.com',
          host: '192.168.1.50:4141',
        },
      });
      const resCsrf = makeRes();
      dashboardSecurityGuard(reqCsrf, resCsrf, () => {});

      assert.equal(resCsrf._getStatus(), 403);
      assert.equal(resCsrf._getBody().error.type, 'cross_origin_refusal');

      delete process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE;
      delete process.env.PROMPTRELAY_DASHBOARD_TOKEN;
    });
  });

  describe('Gateway /v1/* Authentication Middleware & Endpoints', () => {
    let server;
    let port;

    before(async () => {
      process.env.PROMPTRELAY_GATEWAY_KEY = 'gateway-secret-token-key';
      const app = createApp();
      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    });

    after((done) => {
      delete process.env.PROMPTRELAY_GATEWAY_KEY;
      server.close(done);
    });

    it('allows unauthenticated access to /health (health endpoint policy)', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });

    it('allows unauthenticated access to root /', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.name, 'PromptRelay');
    });

    it('rejects /v1 endpoints when token is missing', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.type, 'missing_api_key');
    });

    it('rejects /v1 endpoints when token is invalid', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { authorization: 'Bearer invalid-token-value' },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.type, 'invalid_api_key');
    });

    it('accepts /v1 endpoints with valid Authorization header', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { authorization: 'Bearer gateway-secret-token-key' },
      });
      // 200 or 500 depending on upstream mock, but NOT 401!
      assert.notEqual(res.status, 401);
    });

    it('accepts /v1 endpoints with valid x-api-key header', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { 'x-api-key': 'gateway-secret-token-key' },
      });
      assert.notEqual(res.status, 401);
    });
  });

  describe('JSON Body Limit & Oversized Body Protection', () => {
    let server;
    let port;

    before(async () => {
      const app = createApp();
      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    });

    after((done) => {
      server.close(done);
    });

    it('rejects oversized JSON payload (> 2MB default)', async () => {
      // Create payload larger than 2MB
      const bigString = 'x'.repeat(2.5 * 1024 * 1024);
      const payload = JSON.stringify({ prompt: bigString });

      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });

      // Express body parser returns 413 Payload Too Large
      assert.equal(res.status, 413);
    });
  });
});
