const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyPromptPolicy } = require('../src/prompt');

function configFor(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-'));
  const promptFile = path.join(dir, 'system_prompt.txt');
  fs.writeFileSync(promptFile, 'CUSTOM', 'utf8');
  return {
    prompt: { mode, placeholder: 'PLACEHOLDER' },
    paths: { promptFile },
  };
}

const messages = [
  { role: 'system', content: 'SYSTEM' },
  { role: 'developer', content: 'DEV' },
  { role: 'user', content: 'USER' },
];

test('replace removes system/developer and injects custom system', () => {
  const out = applyPromptPolicy(messages, configFor('replace'));
  assert.deepEqual(out, [
    { role: 'system', content: 'CUSTOM' },
    { role: 'user', content: 'USER' },
  ]);
});

test('prepend keeps original messages after custom system', () => {
  const out = applyPromptPolicy(messages, configFor('prepend'));
  assert.equal(out[0].content, 'CUSTOM');
  assert.equal(out[1].content, 'SYSTEM');
  assert.equal(out.length, 4);
});

test('append places custom after privileged messages', () => {
  const out = applyPromptPolicy(messages, configFor('append'));
  assert.deepEqual(out.map((m) => m.content), ['SYSTEM', 'DEV', 'CUSTOM', 'USER']);
});

test('passthrough does not modify messages', () => {
  const out = applyPromptPolicy(messages, configFor('passthrough'));
  assert.deepEqual(out, messages);
});
