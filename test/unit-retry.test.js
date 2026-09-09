'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRetryAfter,
  backoffDelay,
  isRetryableStatus,
  isRetryableError,
  DEFAULT_RETRY,
} = require('../src/adapters/retry');

test('parseRetryAfter handles seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(null), null);
  const future = new Date(Date.now() + 5000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms >= 3000 && ms <= 6000, `expected ~5000, got ${ms}`);
});

test('backoffDelay stays within [0, exp] and respects maxDelay', () => {
  const retry = { baseDelayMs: 500, maxDelayMs: 8000 };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const exp = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
    const delay = backoffDelay(attempt, retry);
    assert.ok(delay >= 0 && delay <= exp, `attempt ${attempt}: ${delay} not in [0, ${exp}]`);
  }
});

test('isRetryableStatus matches default retryable codes', () => {
  for (const code of DEFAULT_RETRY.retryableStatus) {
    assert.equal(isRetryableStatus(code, DEFAULT_RETRY), true);
  }
  assert.equal(isRetryableStatus(400, DEFAULT_RETRY), false);
  assert.equal(isRetryableStatus(200, DEFAULT_RETRY), false);
});

test('isRetryableError is false for AbortError, true otherwise', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(isRetryableError(abort), false);
  assert.equal(isRetryableError(new Error('ECONNRESET')), true);
  assert.equal(isRetryableError(null), false);
});
