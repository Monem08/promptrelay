const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = path.resolve(__dirname, '..', 'bin', 'promptrelay.js');

test('CLI prints package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^1\.1\.0$/);
});

test('CLI help exposes setup and provider wizard commands', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /promptrelay setup/);
  assert.match(result.stdout, /promptrelay provider/);
  assert.match(result.stdout, /promptrelay doctor/);
});

test('CLI init creates user config files without overwriting later edits', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-cli-'));
  const env = { ...process.env, PROMPTRELAY_HOME: home };

  const first = spawnSync(process.execPath, [cli, 'init'], { encoding: 'utf8', env });
  assert.equal(first.status, 0);
  assert.ok(fs.existsSync(path.join(home, 'promptrelay.json')));
  assert.ok(fs.existsSync(path.join(home, 'system_prompt.txt')));
  assert.ok(fs.existsSync(path.join(home, 'opencode.jsonc.example')));

  const promptFile = path.join(home, 'system_prompt.txt');
  fs.writeFileSync(promptFile, 'MY CUSTOM PROMPT\n', 'utf8');

  const second = spawnSync(process.execPath, [cli, 'init'], { encoding: 'utf8', env });
  assert.equal(second.status, 0);
  assert.equal(fs.readFileSync(promptFile, 'utf8'), 'MY CUSTOM PROMPT\n');
});
