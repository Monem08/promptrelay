'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBaseURL,
  normalizeProviderURL,
  stripEndpointSuffix,
  dedupeVersionSegment,
  hasVersionSegment,
  joinURL,
  candidateBaseURLs,
} = require('../src/providers/urls');

test('normalizeBaseURL adds scheme and trims trailing slashes', () => {
  assert.equal(normalizeBaseURL('openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1');
  assert.equal(normalizeBaseURL('localhost:11434'), 'http://localhost:11434');
  assert.equal(normalizeBaseURL('127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  assert.equal(normalizeBaseURL('https://x.test//'), 'https://x.test');
  assert.equal(normalizeBaseURL(''), '');
});

test('stripEndpointSuffix removes accidental endpoint paths', () => {
  assert.equal(stripEndpointSuffix('https://x.test/v1/chat/completions'), 'https://x.test/v1');
  assert.equal(stripEndpointSuffix('https://x.test/v1/models'), 'https://x.test/v1');
  assert.equal(stripEndpointSuffix('https://x.test/api/chat'), 'https://x.test');
});

test('dedupeVersionSegment collapses repeated /v1', () => {
  assert.equal(dedupeVersionSegment('https://x.test/v1/v1'), 'https://x.test/v1');
  assert.equal(dedupeVersionSegment('https://x.test/v1/v1/v1/models'), 'https://x.test/v1/models');
});

test('normalizeProviderURL composes all fixes', () => {
  assert.equal(
    normalizeProviderURL('openrouter.ai/api/v1/v1/chat/completions/'),
    'https://openrouter.ai/api/v1',
  );
});

test('hasVersionSegment detects trailing version', () => {
  assert.equal(hasVersionSegment('https://x.test/v1'), true);
  assert.equal(hasVersionSegment('https://x.test'), false);
});

test('joinURL de-duplicates a /v1 boundary', () => {
  assert.equal(joinURL('https://x.test/v1', 'v1/models'), 'https://x.test/v1/models');
  assert.equal(joinURL('https://x.test/v1', 'models'), 'https://x.test/v1/models');
  assert.equal(joinURL('https://x.test', '/api/chat'), 'https://x.test/api/chat');
});

test('candidateBaseURLs yields with and without /v1', () => {
  const withV1 = candidateBaseURLs('https://x.test');
  assert.ok(withV1.includes('https://x.test'));
  assert.ok(withV1.includes('https://x.test/v1'));

  const stripped = candidateBaseURLs('https://x.test/v1');
  assert.ok(stripped.includes('https://x.test/v1'));
  assert.ok(stripped.includes('https://x.test'));
});
