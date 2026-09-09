'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'promptrelay.js');

function run(args, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PROMPTRELAY_HOME: home, EDITOR: '' },
  });
}

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-cmd-'));
  run(['init'], home);
  return home;
}

test('reasoning list prints canonical levels', () => {
  const home = freshHome();
  const res = run(['reasoning', 'list'], home);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /none/);
  assert.match(res.stdout, /max/);
  assert.match(res.stdout, /auto/);
});

test('reasoning set persists to config', () => {
  const home = freshHome();
  const res = run(['reasoning', 'set', 'high'], home);
  assert.equal(res.status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'promptrelay.json'), 'utf8'));
  assert.equal(config.reasoning.default, 'high');
  assert.equal(config.reasoning.auto, false);
});

test('reasoning set auto toggles auto mode', () => {
  const home = freshHome();
  run(['reasoning', 'set', 'auto'], home);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'promptrelay.json'), 'utf8'));
  assert.equal(config.reasoning.auto, true);
});

test('reasoning set rejects an invalid level', () => {
  const home = freshHome();
  const res = run(['reasoning', 'set', 'ludicrous'], home);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr + res.stdout, /Invalid reasoning level/);
});

test('model use updates the active model', () => {
  const home = freshHome();
  const res = run(['model', 'use', 'my/custom-model'], home);
  assert.equal(res.status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'promptrelay.json'), 'utf8'));
  assert.equal(config.provider.model, 'my/custom-model');
});

test('keys set stores masked value; keys list shows the name; keys remove deletes it', () => {
  const home = freshHome();
  const set = run(['keys', 'set', 'PROVIDER_API_KEY', 'sk-abcdef123456789'], home);
  assert.equal(set.status, 0);
  assert.ok(!set.stdout.includes('sk-abcdef123456789'), 'raw key must not be printed');

  const envContent = fs.readFileSync(path.join(home, '.env'), 'utf8');
  assert.match(envContent, /PROVIDER_API_KEY=/);

  const list = run(['keys', 'list'], home);
  assert.match(list.stdout, /PROVIDER_API_KEY/);

  const remove = run(['keys', 'remove', 'PROVIDER_API_KEY'], home);
  assert.equal(remove.status, 0);
  const after = run(['keys', 'list'], home);
  assert.ok(!/PROVIDER_API_KEY/.test(after.stdout) || /\(none\)/.test(after.stdout));
});

test('config validate passes on a fresh config and reports problems on a broken one', () => {
  const home = freshHome();
  const ok = run(['config', 'validate'], home);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /valid/i);

  // Break the config with an invalid transport (survives the defaults merge).
  const file = path.join(home, 'promptrelay.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.provider.transport = 'not-a-real-transport';
  fs.writeFileSync(file, JSON.stringify(config), 'utf8');

  const bad = run(['config', 'validate'], home);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /transport/);
});

test('provider list shows the inline active provider', () => {
  const home = freshHome();
  const res = run(['provider', 'list'], home);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /active/);
});

test('opencode status runs without a config present', () => {
  const home = freshHome();
  const res = run(['opencode', 'status'], home);
  assert.match(res.stdout, /OpenCode integration/);
});

test('unknown command exits non-zero and prints help', () => {
  const home = freshHome();
  const res = run(['definitely-not-a-command'], home);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr + res.stdout, /Unknown command/);
});
