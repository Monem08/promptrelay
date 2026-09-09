'use strict';

// Client adapter tests. These write to throwaway fixture files (never the real
// ~/.claude or ~/.hermes) and assert the three invariants that matter most:
//  1. No upstream provider key is ever written into a client config.
//  2. Existing/unrelated configuration is preserved (non-destructive merge).
//  3. A backup is created before mutating an existing file, and `remove`
//     strips only the keys PromptRelay manages.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const claudeCode = require('../src/clients/claude-code');
const hermes = require('../src/clients/hermes');
const { getClient, resolveId, listClients } = require('../src/clients/registry');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-client-'));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry resolves aliases and lists supported clients', () => {
  assert.equal(resolveId('claude'), 'claude-code');
  assert.equal(resolveId('oc'), 'opencode');
  assert.equal(getClient('claude').id, 'claude-code');
  assert.equal(getClient('nope'), null);
  const ids = listClients().map((c) => c.id);
  assert.deepEqual(ids.sort(), ['claude-code', 'hermes', 'opencode']);
});

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

test('claude-code: configure preserves unrelated settings + env and writes managed keys', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  // Pre-existing settings a user might have.
  fs.writeFileSync(file, JSON.stringify({
    theme: 'dark',
    env: { MY_OTHER_VAR: 'keep-me', ANTHROPIC_AUTH_TOKEN: 'old' },
  }, null, 2));

  const res = claudeCode.configure({
    baseURL: 'http://127.0.0.1:4141',
    model: 'claude-sonnet-4-20250514',
    smallModel: 'claude-haiku',
    targetPath: file,
  });

  assert.equal(res.created, false);
  assert.ok(res.backupPath && fs.existsSync(res.backupPath), 'a backup must be created for an existing file');

  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.theme, 'dark', 'unrelated top-level settings preserved');
  assert.equal(cfg.env.MY_OTHER_VAR, 'keep-me', 'unrelated env vars preserved');
  assert.equal(cfg.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4141');
  assert.equal(cfg.env.ANTHROPIC_MODEL, 'claude-sonnet-4-20250514');
  assert.equal(cfg.env.ANTHROPIC_SMALL_FAST_MODEL, 'claude-haiku');
  // Local placeholder token, NOT an upstream key.
  assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, claudeCode.LOCAL_TOKEN);
});

test('claude-code: refuses to write an upstream provider key (leak guard)', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  assert.throws(
    () => claudeCode.configure({ baseURL: 'http://127.0.0.1:4141', model: 'm', token: 'sk-ant-realsecret123', targetPath: file }),
    /Refusing to write an upstream provider key/,
  );
  // Nothing must have been written.
  assert.equal(fs.existsSync(file), false);
});

test('claude-code: no config file contains an upstream-looking secret', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  claudeCode.configure({ baseURL: 'http://127.0.0.1:4141', model: 'm', targetPath: file });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!/sk-ant-/.test(raw), 'client config must never contain an Anthropic key');
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(raw), 'client config must never contain an OpenAI-style key');
});

test('claude-code: remove strips only managed keys and keeps the rest', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  claudeCode.configure({ baseURL: 'http://127.0.0.1:4141', model: 'm', targetPath: file });
  // Add an unrelated env var after setup.
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.env.KEEP = 'yes';
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));

  const res = claudeCode.remove({ targetPath: file });
  assert.equal(res.removed, true);
  assert.ok(res.backupPath && fs.existsSync(res.backupPath));
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.env.KEEP, 'yes', 'unrelated env var preserved after remove');
  for (const k of claudeCode.MANAGED_KEYS) {
    assert.equal(after.env[k], undefined, `${k} must be removed`);
  }
});

// ---------------------------------------------------------------------------
// Hermes
// ---------------------------------------------------------------------------

test('hermes: configure preserves unrelated yaml keys and writes the provider block', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'config.yaml');
  const env = path.join(dir, '.env');
  fs.writeFileSync(file, yaml.dump({ logging: { level: 'info' }, agents: { max: 3 } }));

  const res = hermes.configure({ baseURL: 'http://127.0.0.1:4141/v1', model: 'my-model', targetConfig: file, targetEnv: env });
  assert.equal(res.created, false);
  assert.ok(res.backupPath && fs.existsSync(res.backupPath), 'a backup must be created for an existing file');

  const cfg = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(cfg.logging, { level: 'info' }, 'unrelated yaml keys preserved');
  assert.equal(cfg.agents.max, 3);
  assert.equal(cfg.model.provider, 'custom');
  assert.equal(cfg.model.base_url, 'http://127.0.0.1:4141/v1');
  assert.equal(cfg.model.model, 'my-model');
  // api_key must be a ${VAR} reference, not a literal secret.
  assert.equal(cfg.model.api_key, '${PROMPTRELAY_API_KEY}');
});

test('hermes: normalizeBaseURL always yields a single trailing /v1', () => {
  assert.equal(hermes.normalizeBaseURL('http://h:4141'), 'http://h:4141/v1');
  assert.equal(hermes.normalizeBaseURL('http://h:4141/'), 'http://h:4141/v1');
  assert.equal(hermes.normalizeBaseURL('http://h:4141/v1'), 'http://h:4141/v1');
  assert.equal(hermes.normalizeBaseURL('http://h:4141/v1/'), 'http://h:4141/v1');
});

test('hermes: .env holds a local placeholder, config never holds a literal secret', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'config.yaml');
  const env = path.join(dir, '.env');
  hermes.configure({ baseURL: 'http://127.0.0.1:4141/v1', model: 'm', targetConfig: file, targetEnv: env });

  const envRaw = fs.readFileSync(env, 'utf8');
  assert.match(envRaw, /PROMPTRELAY_API_KEY=promptrelay-local/);
  const cfgRaw = fs.readFileSync(file, 'utf8');
  assert.ok(!/sk-/.test(cfgRaw), 'config.yaml must not contain any upstream key');
});

test('hermes: remove strips the managed model block and env key, keeps the rest', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'config.yaml');
  const env = path.join(dir, '.env');
  fs.writeFileSync(env, 'UNRELATED=stay\n');
  fs.writeFileSync(file, yaml.dump({ logging: { level: 'info' } }));
  hermes.configure({ baseURL: 'http://127.0.0.1:4141/v1', model: 'm', targetConfig: file, targetEnv: env });

  const res = hermes.remove({ targetConfig: file, targetEnv: env });
  assert.equal(res.removed, true);
  const cfg = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.model, undefined, 'managed model block removed');
  assert.deepEqual(cfg.logging, { level: 'info' }, 'unrelated keys preserved');
  const envRaw = fs.readFileSync(env, 'utf8');
  assert.match(envRaw, /UNRELATED=stay/);
  assert.ok(!/PROMPTRELAY_API_KEY/.test(envRaw), 'managed env key removed');
});
