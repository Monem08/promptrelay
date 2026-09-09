'use strict';

const { normalizeProviderURL, candidateBaseURLs, joinURL } = require('./urls');

/**
 * Provider auto-detection.
 *
 * Probes candidate base URLs / model endpoints to discover:
 *  - the working base URL (with correct /v1 placement)
 *  - the models path that returns data
 *  - whether the endpoint behaves OpenAI-compatible or Ollama-native
 *  - whether the provided auth is accepted
 *
 * NEVER fabricates results. Anything not observed is reported as 'unknown'.
 */

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function buildAuthHeaders(auth, apiKey) {
  const headers = { Accept: 'application/json' };
  if (!apiKey) return headers;
  const type = String(auth?.type || 'bearer').toLowerCase();
  if (type === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  else if (type === 'header') headers[auth?.headerName || 'x-api-key'] = apiKey;
  return headers;
}

/**
 * Classify a parsed models response body.
 * @returns {{ shape: 'openai'|'ollama'|'unknown', count: number|'unknown' }}
 */
function classifyModelsBody(body) {
  if (!body || typeof body !== 'object') return { shape: 'unknown', count: 'unknown' };
  if (Array.isArray(body.data)) return { shape: 'openai', count: body.data.length };
  if (Array.isArray(body.models)) return { shape: 'ollama', count: body.models.length };
  if (Array.isArray(body)) return { shape: 'openai', count: body.length };
  return { shape: 'unknown', count: 'unknown' };
}

/**
 * Probe a single URL for a models listing.
 * @returns {Promise<{ ok: boolean, status: number|'unknown', shape: string, count: number|'unknown', authRequired: boolean }>}
 */
async function probeModelsURL(url, headers, timeoutMs) {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers }, timeoutMs);
    const status = res.status;
    const authRequired = status === 401 || status === 403;
    let shape = 'unknown';
    let count = 'unknown';
    if (res.ok) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const classified = classifyModelsBody(body);
      shape = classified.shape;
      count = classified.count;
    }
    return { ok: res.ok, status, shape, count, authRequired };
  } catch (error) {
    return { ok: false, status: 'unknown', shape: 'unknown', count: 'unknown', authRequired: false, error: error.message };
  }
}

/**
 * Detect a provider's working configuration.
 *
 * @param {object} input
 * @param {string} input.baseURL - user-provided base URL
 * @param {string} [input.apiKey]
 * @param {object} [input.auth] - { type, headerName }
 * @param {number} [input.timeoutMs]
 * @returns {Promise<object>} detection result
 */
async function detectProvider(input) {
  const { baseURL, apiKey = '', auth = { type: apiKey ? 'bearer' : 'none' }, timeoutMs = DEFAULT_TIMEOUT_MS } = input;

  const result = {
    input: baseURL,
    normalizedBaseURL: normalizeProviderURL(baseURL),
    detectedBaseURL: 'unknown',
    modelsPath: 'unknown',
    transport: 'unknown',
    shape: 'unknown',
    modelCount: 'unknown',
    authAccepted: 'unknown',
    reachable: false,
    attempts: [],
  };

  if (!result.normalizedBaseURL) {
    result.error = 'Invalid or empty base URL';
    return result;
  }

  const headers = buildAuthHeaders(auth, apiKey);
  const bases = candidateBaseURLs(baseURL);
  // Model listing paths to try for each candidate base.
  const modelPaths = ['models', 'v1/models', 'api/tags'];

  for (const base of bases) {
    for (const mp of modelPaths) {
      const url = joinURL(base, mp);
      const probe = await probeModelsURL(url, headers, timeoutMs);
      result.attempts.push({ url, status: probe.status, ok: probe.ok, shape: probe.shape, count: probe.count });

      if (probe.status !== 'unknown') result.reachable = true;

      if (probe.ok && probe.shape !== 'unknown') {
        result.detectedBaseURL = base;
        result.modelsPath = mp === 'api/tags' ? mp : mp;
        result.shape = probe.shape;
        result.modelCount = probe.count;
        result.authAccepted = apiKey ? true : 'n/a';
        // Transport inference: ollama shape or api/tags => ollama-native; openai shape => openai-compatible.
        if (probe.shape === 'ollama' || mp === 'api/tags') result.transport = 'ollama-native';
        else result.transport = 'openai-compatible';
        return result;
      }

      // If auth is required and we sent a key, note that the key was rejected.
      if (probe.authRequired && apiKey) {
        result.authAccepted = false;
      }
    }
  }

  return result;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
  buildAuthHeaders,
  classifyModelsBody,
  probeModelsURL,
  detectProvider,
};
