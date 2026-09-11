'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const service = require('../src/service/manager');
const doctor = require('../src/doctor');
const scopes = require('../src/prompts/scopes');
const { createApp } = require('../src/server/app');
const { safeWriteJsonSync } = require('../src/config/safe-write');
const registry = require('../src/clients/registry');

describe('Batch B: Service Manager', () => {
  it('reports service status for the current operating system', () => {
    const s = service.status();
    assert.equal(s.platform, process.platform);
    assert.ok(typeof s.serviceType === 'string');
    assert.ok(typeof s.installed === 'boolean');
    assert.ok(typeof s.running === 'boolean');
  });

  it('generates a valid systemd unit definition with environment file', () => {
    const unit = service.generateSystemdUnit('/usr/bin/node', '/opt/promptrelay/src/server.js', '/etc/promptrelay.env');
    assert.ok(unit.includes('[Unit]'));
    assert.ok(unit.includes('[Service]'));
    assert.ok(unit.includes('ExecStart=/usr/bin/node /opt/promptrelay/src/server.js'));
    assert.ok(unit.includes('Restart=always'));
    assert.ok(unit.includes('WantedBy=default.target'));
  });

  it('generates a valid launchd plist XML with ProgramArguments', () => {
    const plist = service.generateLaunchdPlist('/usr/local/bin/node', '/opt/promptrelay/src/server.js');
    assert.ok(plist.includes('<?xml version="1.0"'));
    assert.ok(plist.includes('<key>Label</key>'));
    assert.ok(plist.includes(`<string>${service.LAUNCHD_LABEL}</string>`));
    assert.ok(plist.includes('<string>/usr/local/bin/node</string>'));
    assert.ok(plist.includes('<key>RunAtLoad</key>'));
  });
});

describe('Batch B: Self-Healing Doctor and Repair', () => {
  let tmpDir;
  let savedConfigEnv;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-doctor-test-'));
    savedConfigEnv = process.env.PROMPTRELAY_CONFIG;
  });

  after(() => {
    if (savedConfigEnv) process.env.PROMPTRELAY_CONFIG = savedConfigEnv;
    else delete process.env.PROMPTRELAY_CONFIG;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('checkNode validates version >= 18', () => {
    const res = doctor.checkNode();
    assert.equal(res.ok, true);
    assert.ok(res.version);
  });

  it('checkClients returns status for all supported clients', () => {
    const res = doctor.checkClients();
    assert.ok(Array.isArray(res.clients));
    assert.ok(res.clients.length >= 3);
    const ids = res.clients.map((c) => c.id);
    assert.ok(ids.includes('opencode'));
    assert.ok(ids.includes('claude-code'));
    assert.ok(ids.includes('hermes'));
  });

  it('repair heals corrupted config from backup', () => {
    const testConfigPath = path.join(tmpDir, 'promptrelay.json');
    process.env.PROMPTRELAY_CONFIG = testConfigPath;

    // Create a valid config and backup
    const validConfig = {
      version: 3,
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: path.join(tmpDir, 'prompt.txt'), configFile: testConfigPath },
      prompt: { mode: 'replace', placeholder: '{PLACEHOLDER}' },
      provider: { name: 'Test', baseURL: 'http://localhost:11434', transport: 'openai-compatible', model: 'test' },
      providers: {},
      fallback: { enabled: false },
      retry: { maxRetries: 1 },
      reasoning: { default: 'low' },
      logging: { requests: false },
    };
    safeWriteJsonSync({ filePath: testConfigPath, data: validConfig });
    const { createBackup } = require('../src/config/safe-write');
    createBackup(testConfigPath);

    // Now corrupt the file with invalid JSON
    fs.writeFileSync(testConfigPath, '{ not valid json !!', 'utf8');

    // Run repair
    const repairResult = fs.readFileSync(testConfigPath, 'utf8');
    assert.ok(repairResult.includes('not valid'));

    // Repair should restore from backup
    return doctor.repair().then((res) => {
      assert.ok(res.repaired.some((r) => r.includes('Restored corrupted config from backup')));
      const restored = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.equal(restored.version, 3);
    });
  });

  it('repair fixes duplicated /v1/v1 baseURL', async () => {
    const testConfigPath = path.join(tmpDir, 'promptrelay-dupe.json');
    process.env.PROMPTRELAY_CONFIG = testConfigPath;

    const config = {
      version: 3,
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: path.join(tmpDir, 'prompt.txt'), configFile: testConfigPath },
      prompt: { mode: 'replace', placeholder: '{PLACEHOLDER}' },
      provider: { name: 'Test', baseURL: 'http://localhost:11434/v1/v1', transport: 'openai-compatible', model: 'test' },
      providers: {},
      fallback: { enabled: false },
      retry: { maxRetries: 1 },
      reasoning: { default: 'low' },
      logging: { requests: false },
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2), 'utf8');

    const res = await doctor.repair();
    assert.ok(res.repaired.some((r) => r.includes('Fixed duplicated /v1')));
    const fixed = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
    assert.equal(fixed.provider.baseURL, 'http://localhost:11434/v1');
  });
});

describe('Batch B: Anthropic Ingress Fallback and Parity', () => {
  let primaryServer;
  let backupServer;
  let primaryPort;
  let backupPort;
  let savedConfigEnv;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-anthropic-fallback-'));
    savedConfigEnv = process.env.PROMPTRELAY_CONFIG;

    // Primary server always returns 503
    primaryServer = http.createServer((req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Primary unavailable' } }));
    });
    await new Promise((resolve) => primaryServer.listen(0, '127.0.0.1', resolve));
    primaryPort = primaryServer.address().port;

    // Backup server returns valid OpenAI completion
    backupServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-backup-1',
        object: 'chat.completion',
        created: 123456789,
        model: 'backup-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from fallback backup!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }));
    });
    await new Promise((resolve) => backupServer.listen(0, '127.0.0.1', resolve));
    backupPort = backupServer.address().port;

    // Create config pointing to primary with fallback to backup
    const testConfigPath = path.join(tmpDir, 'promptrelay.json');
    const promptPath = path.join(tmpDir, 'system_prompt.txt');
    fs.writeFileSync(promptPath, 'Be helpful.', 'utf8');

    const config = {
      version: 3,
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: promptPath, configFile: testConfigPath },
      prompt: { mode: 'replace', placeholder: '{PLACEHOLDER}' },
      provider: {
        name: 'Primary Fail',
        baseURL: `http://127.0.0.1:${primaryPort}/v1`,
        transport: 'openai-compatible',
        model: 'primary-model',
        auth: { type: 'none' },
      },
      providers: {
        BackupProvider: {
          name: 'BackupProvider',
          baseURL: `http://127.0.0.1:${backupPort}/v1`,
          transport: 'openai-compatible',
          model: 'backup-model',
          auth: { type: 'none' },
        },
      },
      fallback: {
        enabled: true,
        providers: ['BackupProvider'],
      },
      retry: { maxRetries: 0 },
      reasoning: { default: 'low' },
      logging: { requests: false },
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = testConfigPath;
  });

  after(async () => {
    if (savedConfigEnv) process.env.PROMPTRELAY_CONFIG = savedConfigEnv;
    else delete process.env.PROMPTRELAY_CONFIG;
    await new Promise((r) => primaryServer.close(r));
    await new Promise((r) => backupServer.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('Anthropic ingress falls back to backup provider on primary failure', async () => {
    const app = createApp();

    // Start ephemeral server for app
    const testAppServer = http.createServer(app);
    await new Promise((resolve) => testAppServer.listen(0, '127.0.0.1', resolve));
    const appPort = testAppServer.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-promptrelay-client': 'claude-code',
        },
        body: JSON.stringify({
          model: 'primary-model',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Test prompt' }],
        }),
      });

      assert.equal(response.status, 200);
      const json = await response.json();
      // Should receive Anthropic Messages shape from the fallback provider
      assert.equal(json.type, 'message');
      assert.equal(json.role, 'assistant');
      assert.ok(json.content.some((c) => c.type === 'text' && c.text.includes('Hello from fallback backup!')));
    } finally {
      await new Promise((r) => testAppServer.close(r));
    }
  });
});

describe('Batch B: Per-Client Prompt Scopes', () => {
  let tmpDir;
  let savedConfigEnv;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-scopes-test-'));
    savedConfigEnv = process.env.PROMPTRELAY_CONFIG;
  });

  after(() => {
    if (savedConfigEnv) process.env.PROMPTRELAY_CONFIG = savedConfigEnv;
    else delete process.env.PROMPTRELAY_CONFIG;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('resolves per-client prompt scope when configured, falls back to global', () => {
    const globalPromptPath = path.join(tmpDir, 'system_prompt.txt');
    const claudePromptPath = path.join(tmpDir, 'system_prompt_claude.txt');
    fs.writeFileSync(globalPromptPath, 'Global Instructions', 'utf8');
    fs.writeFileSync(claudePromptPath, 'Claude Code Special Instructions', 'utf8');

    const config = {
      paths: { promptFile: globalPromptPath, root: tmpDir },
      prompt: { mode: 'replace' },
      promptScopes: {
        'claude-code': { file: 'system_prompt_claude.txt', mode: 'append' },
      },
    };

    // Unknown or default client gets global
    const globalResolved = scopes.resolvePrompt('unknown', config);
    assert.equal(globalResolved.text, 'Global Instructions');
    assert.equal(globalResolved.mode, 'replace');

    // claude-code client gets scoped prompt and mode
    const claudeResolved = scopes.resolvePrompt('claude-code', config);
    assert.equal(claudeResolved.text, 'Claude Code Special Instructions');
    assert.equal(claudeResolved.mode, 'append');
    assert.equal(claudeResolved.scope, 'claude-code');
  });

  it('lists configured scopes including global and clients', () => {
    const globalPromptPath = path.join(tmpDir, 'system_prompt.txt');
    const config = {
      paths: { promptFile: globalPromptPath, root: tmpDir },
      prompt: { mode: 'replace' },
      promptScopes: {
        hermes: { file: 'system_prompt_hermes.txt', mode: 'prepend' },
      },
    };

    const list = scopes.listScopes(config);
    assert.equal(list.length, 2);
    assert.equal(list[0].scope, 'global');
    assert.equal(list[1].scope, 'hermes');
    assert.equal(list[1].mode, 'prepend');
  });
});
