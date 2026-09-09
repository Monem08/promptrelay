'use strict';

/**
 * Smart retry for transient upstream errors.
 *
 * Retries only idempotent-at-connection failures: network errors and the
 * configured retryable status codes (default 429/502/503/504). Uses exponential
 * backoff with jitter, and honors a `Retry-After` header when present.
 *
 * Because retries happen BEFORE any bytes are written to the client, this is
 * safe for both streaming and non-streaming requests.
 */

const DEFAULT_RETRY = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  retryableStatus: [429, 502, 503, 504],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Compute backoff delay for a given attempt (0-based), with full jitter.
 */
function backoffDelay(attempt, retry) {
  const base = retry.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const max = retry.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const exp = Math.min(max, base * 2 ** attempt);
  // Full jitter: random between 0 and exp.
  return Math.floor(Math.random() * exp);
}

function isRetryableStatus(status, retry) {
  const codes = retry.retryableStatus || DEFAULT_RETRY.retryableStatus;
  return codes.includes(status);
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  // Network-level failures from undici/fetch.
  return true;
}

/**
 * Perform a fetch with retry semantics.
 *
 * @param {string} url
 * @param {object} fetchOptions
 * @param {object} retryConfig
 * @param {{ onRetry?: (info: object) => void, signal?: AbortSignal }} [hooks]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, fetchOptions, retryConfig, hooks = {}) {
  const retry = { ...DEFAULT_RETRY, ...(retryConfig || {}) };
  const maxRetries = retry.enabled ? Math.max(0, retry.maxRetries) : 0;
  const onRetry = typeof hooks.onRetry === 'function' ? hooks.onRetry : () => {};

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    // If the caller's signal already aborted, stop.
    if (fetchOptions.signal?.aborted) {
      const err = new Error('Request aborted');
      err.name = 'AbortError';
      throw err;
    }

    try {
      const res = await fetch(url, fetchOptions);
      if (attempt < maxRetries && isRetryableStatus(res.status, retry)) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const delay = retryAfter != null ? retryAfter : backoffDelay(attempt, retry);
        onRetry({ attempt: attempt + 1, maxRetries, status: res.status, delayMs: delay, url });
        // Drain the body so the socket can be reused.
        try { await res.arrayBuffer(); } catch {}
        await sleep(delay);
        attempt += 1;
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') throw error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = backoffDelay(attempt, retry);
        onRetry({ attempt: attempt + 1, maxRetries, error: error.message, delayMs: delay, url });
        await sleep(delay);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }

  // Exhausted retries after a retryable status: do one final attempt result.
  if (lastError) throw lastError;
  return fetch(url, fetchOptions);
}

module.exports = {
  DEFAULT_RETRY,
  sleep,
  parseRetryAfter,
  backoffDelay,
  isRetryableStatus,
  isRetryableError,
  fetchWithRetry,
};
