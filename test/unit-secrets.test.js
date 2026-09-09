'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskSecret,
  looksLikeSecretKey,
  redactAuthHeader,
  redact,
  redactString,
} = require('../src/telemetry/secrets');

test('maskSecret keeps a short prefix/suffix and hides the middle', () => {
  const masked = maskSecret('sk-abcdef1234567890');
  assert.match(masked, /^sk-a\*+90$/);
  assert.ok(!masked.includes('abcdef123456'));
  assert.equal(maskSecret(''), '(not set)');
  assert.equal(maskSecret('abcd'), '****');
});

test('looksLikeSecretKey detects common secret names', () => {
  assert.equal(looksLikeSecretKey('apiKey'), true);
  assert.equal(looksLikeSecretKey('Authorization'), true);
  assert.equal(looksLikeSecretKey('x-api-key'), true);
  assert.equal(looksLikeSecretKey('model'), false);
});

test('redactAuthHeader masks bearer tokens', () => {
  const out = redactAuthHeader('Bearer sk-supersecretvalue12345');
  assert.match(out, /^Bearer sk-s\*+/);
  assert.ok(!out.includes('supersecretvalue'));
});

test('redact deep-copies and masks secret-bearing fields', () => {
  const input = {
    provider: { apiKey: 'sk-secretkey1234567', model: 'gpt-4o' },
    headers: { Authorization: 'Bearer tok-abcdef123456', 'x-api-key': 'zzzsecretzzz9999' },
  };
  const out = redact(input);
  assert.equal(out.provider.model, 'gpt-4o');
  assert.ok(!JSON.stringify(out).includes('sk-secretkey1234567'));
  assert.ok(!JSON.stringify(out).includes('tok-abcdef123456'));
  assert.ok(!JSON.stringify(out).includes('zzzsecretzzz9999'));
  // Original not mutated.
  assert.equal(input.provider.apiKey, 'sk-secretkey1234567');
});

test('redactString scrubs literal secrets and bearer patterns', () => {
  const out = redactString('key is sk-mysecretvalue123 and Bearer abcd1234efgh', ['sk-mysecretvalue123']);
  assert.ok(!out.includes('sk-mysecretvalue123'));
  assert.ok(!out.includes('abcd1234efgh'));
});
