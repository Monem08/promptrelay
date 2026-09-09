'use strict';

const fs = require('fs');

/**
 * Model metadata cache with expiry.
 *
 * Cache entries record their source and timestamps so callers can reason about
 * freshness: { source, retrievedAt, expiresAt, models: [...] }, keyed by
 * provider name + base URL.
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(config) {
  const provider = config?.provider || {};
  return `${provider.name || 'provider'}::${provider.baseURL || ''}`;
}

function readCache(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeCache(file, data) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch {
    // Cache persistence is best-effort.
  }
}

/**
 * Get a cached entry if present and not expired.
 * @returns {object|null}
 */
function getCached(config, { ignoreExpiry = false } = {}) {
  const file = config?.paths?.cacheFile;
  if (!file) return null;
  const all = readCache(file);
  const entry = all[cacheKey(config)];
  if (!entry) return null;
  if (!ignoreExpiry) {
    const expiresAt = Date.parse(entry.expiresAt || '');
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) return null;
  }
  return entry;
}

/**
 * Store models in the cache with source and expiry metadata.
 * @returns {object} the stored entry
 */
function setCached(config, models, { source = 'unknown', ttlMs = DEFAULT_TTL_MS } = {}) {
  const file = config?.paths?.cacheFile;
  const now = Date.now();
  const entry = {
    source,
    retrievedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    provider: config?.provider?.name,
    baseURL: config?.provider?.baseURL,
    models,
  };
  if (!file) return entry;
  const all = readCache(file);
  all[cacheKey(config)] = entry;
  writeCache(file, all);
  return entry;
}

function clearCache(config) {
  const file = config?.paths?.cacheFile;
  if (!file || !fs.existsSync(file)) return false;
  const all = readCache(file);
  delete all[cacheKey(config)];
  writeCache(file, all);
  return true;
}

module.exports = {
  DEFAULT_TTL_MS,
  cacheKey,
  readCache,
  writeCache,
  getCached,
  setCached,
  clearCache,
};
