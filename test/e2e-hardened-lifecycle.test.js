'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const { openAICompatible } = require('../src/testing/mock-server');
const requestLog = require('../src/telemetry/requests');
const { safeWriteJsonSync } = require('../src/config/safe-write');

test('PromptRelay 1.2.0 Hardened End-to-End Lifecycle', async (t) => {
  // Step 1: Uses temporary config and backup directories
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-e2e-hardened-'));
  const configFile = path.join(tmpDir, 'promptrelay.json');
  const promptFile = path.join(tmpDir, 'system_prompt.txt');
  const backupDir = path.join(tmpDir, '.backups');

  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(promptFile, 'GLOBAL_SYSTEM_PROMPT_INSTRUCTION\n', 'utf8');

  // Also create a scoped prompt for OpenCode
  const opencodePromptFile = path.join(tmpDir, 'system_prompt_opencode.txt');
  fs.writeFileSync(opencodePromptFile, 'OPENCODE_SCOPED_SYSTEM_PROMPT\n', 'utf8');

  const SECRET_API_KEY = 'sk-live-super-secret-key-999888';

  // Step 3: Starts at least two mock upstream providers
  // Provider 1: Primary (controllable failure)
  let p1FailCount = 0;
  let p1Calls = 0;
  const p1Server = http.createServer((req, res) => {
    let bodyStr = '';
    req.on('data', (c) => { bodyStr += c; });
    req.on('end', () => {
      p1Calls += 1;
      if (p1FailCount > 0) {
        p1FailCount -= 1;
        res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
        res.end(JSON.stringify({ error: { message: 'Provider 1 temporary overload', type: 'overloaded' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-p1',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Response from Primary Provider 1' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
      }));
    });
  });

  await new Promise((resolve) => p1Server.listen(0, '127.0.0.1', resolve));
  const p1Port = p1Server.address().port;
  const p1Url = `http://127.0.0.1:${p1Port}/v1`;

  // Provider 2: Secondary / Fallback
  let p2Calls = 0;
  const p2Server = http.createServer((req, res) => {
    let bodyStr = '';
    req.on('data', (c) => { bodyStr += c; });
    req.on('end', () => {
      p2Calls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-p2',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Response from Fallback Provider 2' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }));
    });
  });

  await new Promise((resolve) => p2Server.listen(0, '127.0.0.1', resolve));
  const p2Port = p2Server.address().port;
  const p2Url = `http://127.0.0.1:${p2Port}/v1`;

  // Step 4: Configures different client routing profiles
  const initialConfig = {
    version: 3,
    server: { host: '127.0.0.1', port: 4141 },
    prompt: {
      mode: 'replace',
      file: 'system_prompt.txt',
      placeholder: '{Paste your instructions here}',
    },
    promptScopes: {
      opencode: { file: 'system_prompt_opencode.txt', mode: 'prepend' },
    },
    provider: {
      name: 'PrimaryProvider',
      transport: 'openai-compatible',
      baseURL: p1Url,
      model: 'model-primary',
      apiKey: SECRET_API_KEY,
    },
    providers: {
      PrimaryProvider: {
        name: 'PrimaryProvider',
        transport: 'openai-compatible',
        baseURL: p1Url,
        model: 'model-primary',
        apiKey: SECRET_API_KEY,
      },
      FallbackProvider: {
        name: 'FallbackProvider',
        transport: 'openai-compatible',
        baseURL: p2Url,
        model: 'model-fallback',
        apiKey: 'sk-fallback-key',
      },
    },
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 20,
      maxDelayMs: 50,
      retryableStatus: [408, 429, 502, 503, 504],
    },
    fallback: {
      enabled: true,
      providers: ['FallbackProvider'],
    },
    routing: {
      profile: 'balanced',
      clients: {
        opencode: 'code-specialized',
        'claude-code': 'reasoning',
        hermes: 'speed',
      },
    },
    logging: {
      mode: 'metadata',
      requests: true,
    },
    paths: {
      configFile,
      promptFile,
      backupDir,
    },
  };

  fs.writeFileSync(configFile, JSON.stringify(initialConfig, null, 2), 'utf8');

  // Step 2: Starts PromptRelay on a temporary port
  const prevConfigEnv = process.env.PROMPTRELAY_CONFIG;
  process.env.PROMPTRELAY_CONFIG = configFile;

  const { createApp } = require('../src/server/app');
  const app = createApp();
  const gatewayServer = http.createServer(app);
  await new Promise((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
  const gwPort = gatewayServer.address().port;
  const gwUrl = `http://127.0.0.1:${gwPort}`;

  // Clear previous telemetry
  requestLog.clear();

  try {
    // Step 5: Sends an OpenAI-compatible request
    const openaiRes = await fetch(`${gwUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'opencode/1.0.0',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello OpenAI ingress' }],
      }),
    });
    assert.equal(openaiRes.status, 200);
    const openaiData = await openaiRes.json();
    assert.ok(openaiData.choices[0].message.content.includes('Primary Provider 1'));

    // Step 6: Sends an Anthropic /v1/messages request
    const anthropicRes = await fetch(`${gwUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'claude-code/0.2.29',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello Anthropic ingress' }],
      }),
    });
    assert.equal(anthropicRes.status, 200);
    const anthropicData = await anthropicRes.json();
    assert.ok(anthropicData.content[0].text);

    // Step 7: Verifies prompt scope application
    const { loadScopedPrompt } = require('../src/prompts/scopes');
    const globalPrompt = loadScopedPrompt('global', initialConfig);
    const opencodePrompt = loadScopedPrompt('opencode', initialConfig);
    assert.ok(globalPrompt.includes('GLOBAL_SYSTEM_PROMPT_INSTRUCTION'));
    assert.ok(opencodePrompt.includes('OPENCODE_SCOPED_SYSTEM_PROMPT'));

    // Step 8 & 9: Forces a retryable error and verifies retry succeeds
    p1FailCount = 1; // 1 failure then success (maxRetries is 2)
    const retryRes = await fetch(`${gwUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Test retry' }],
      }),
    });
    assert.equal(retryRes.status, 200);
    const retryData = await retryRes.json();
    assert.ok(retryData.choices[0].message.content.includes('Primary Provider 1'));

    // Step 10 & 11: Forces retry exhaustion and verifies fallback to second provider
    p1FailCount = 10; // Exhausts all 2 retries (3 attempts total)
    const fallbackRes = await fetch(`${gwUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Test fallback' }],
      }),
    });
    assert.equal(fallbackRes.status, 200);
    const fallbackData = await fallbackRes.json();
    assert.ok(
      fallbackData.choices[0].message.content.includes('Fallback Provider 2'),
      'Should fall back to Provider 2'
    );
    assert.ok(p2Calls >= 1, 'Provider 2 should have been called');

    // Step 12: Verifies real retry/fallback telemetry
    const metrics = requestLog.metrics();
    assert.ok(metrics.total >= 4, 'Telemetry should have recorded at least 4 requests');
    const recentRequests = requestLog.list({ limit: 10 });
    const fallbackEntry = recentRequests.find((r) => r.fallback === true);
    assert.ok(fallbackEntry, 'Telemetry should record fallback: true');
    assert.ok(fallbackEntry.providerAttempts >= 2, 'Telemetry should record multiple provider attempts');

    // Step 13: Enables Logging Off
    const noLoggingConfig = {
      ...initialConfig,
      logging: { mode: 'off', requests: false },
    };
    safeWriteJsonSync(configFile, noLoggingConfig, { reason: 'test_logging_off' });

    // Step 14: Sends another request with logging off
    const countBefore = requestLog.count();
    const offRes = await fetch(`${gwUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Request during Logging Off' }],
      }),
    });
    assert.equal(offRes.status, 200);

    // Wait a brief tick for finish event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Step 15: Verifies no new request record was stored
    const countAfter = requestLog.count();
    assert.equal(countAfter, countBefore, 'No new request record must be stored when logging is off');

    // Step 16: Verifies no secret appears in response/log output
    const healthRes = await fetch(`${gwUrl}/health`);
    const healthText = await healthRes.text();
    assert.ok(!healthText.includes(SECRET_API_KEY), 'Secret API key must NEVER appear in /health');

    const requestsListStr = JSON.stringify(requestLog.list({ limit: 50 }));
    assert.ok(!requestsListStr.includes(SECRET_API_KEY), 'Secret API key must NEVER appear in request log');

  } finally {
    // Step 17: Shuts down every server and timer cleanly
    if (prevConfigEnv === undefined) delete process.env.PROMPTRELAY_CONFIG;
    else process.env.PROMPTRELAY_CONFIG = prevConfigEnv;

    await new Promise((resolve) => gatewayServer.close(resolve));
    await new Promise((resolve) => p1Server.close(resolve));
    await new Promise((resolve) => p2Server.close(resolve));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
