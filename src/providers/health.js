'use strict';

const fs = require('fs');
const { joinURL } = require('./urls');
const { providerHeaders } = require('./http');
const { fetchWithTimeout, DEFAULT_TIMEOUT_MS } = require('./detect');

/**
 * Provider health checks and persistent health state.
 *
 * - Safe check (default): a GET to the models endpoint. No tokens spent.
 * - Live check (opt-in): a tiny chat completion to confirm end-to-end health.
 *
 * Results are recorded to a health file so `doctor`/`status` can report trends.
 */

function readHealth(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeHealth(file, data) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch {
    // Health persistence is best-effort.
  }
}

function recordHealth(config, entry) {
  const file = config?.paths?.healthFile;
  if (!file) return entry;
  const all = readHealth(file);
  const key = config.provider.name || config.provider.baseURL || 'default';
  all[key] = { ...entry, provider: key };
  writeHealth(file, all);
  return entry;
}

/**
 * Safe health check: probe the provider's models endpoint.
 * @param {object} config
 * @param {{ timeoutMs?: number }} [options]
 */
async function safeCheck(config, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const modelsPath = config.provider.modelsPath
    || (config.provider.transport === 'ollama-native' ? '/v1/models' : 'models');
  const url = joinURL(config.provider.baseURL, modelsPath);
  const startedAt = Date.now();

  const entry = {
    mode: 'safe',
    url,
    ok: false,
    status: 'unknown',
    latencyMs: 'unknown',
    checkedAt: new Date().toISOString(),
    error: null,
  };

  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: providerHeaders(config) }, timeoutMs);
    entry.status = res.status;
    entry.latencyMs = Date.now() - startedAt;
    entry.ok = res.ok;
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      entry.error = 'Authentication rejected by provider';
    }
  } catch (error) {
    entry.error = error.message;
    entry.latencyMs = Date.now() - startedAt;
  }

  return recordHealth(config, entry);
}

/**
 * Live health check: send a minimal chat request (opt-in, may spend tokens).
 * @param {object} config
 * @param {{ timeoutMs?: number }} [options]
 */
async function liveCheck(config, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const entry = {
    mode: 'live',
    ok: false,
    status: 'unknown',
    latencyMs: 'unknown',
    checkedAt: new Date().toISOString(),
    error: null,
  };

  try {
    let url;
    let body;
    if (config.provider.transport === 'ollama-native') {
      url = joinURL(config.provider.baseURL, config.provider.chatPath || '/api/chat');
      body = {
        model: config.provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      };
    } else {
      url = joinURL(config.provider.baseURL, config.provider.chatPath || 'chat/completions');
      body = {
        model: config.provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      };
    }
    entry.url = url;

    const res = await fetchWithTimeout(
      url,
      { method: 'POST', headers: providerHeaders(config), body: JSON.stringify(body) },
      timeoutMs,
    );
    entry.status = res.status;
    entry.latencyMs = Date.now() - startedAt;
    entry.ok = res.ok;
    if (!res.ok) {
      const text = await res.text();
      entry.error = text.slice(0, 300);
    }
  } catch (error) {
    entry.error = error.message;
    entry.latencyMs = Date.now() - startedAt;
  }

  return recordHealth(config, entry);
}

module.exports = {
  readHealth,
  writeHealth,
  recordHealth,
  safeCheck,
  liveCheck,
};
