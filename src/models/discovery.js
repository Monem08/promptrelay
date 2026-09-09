'use strict';

const { joinURL } = require('../providers/urls');
const { providerHeaders } = require('../providers/http');
const { fetchWithTimeout, DEFAULT_TIMEOUT_MS } = require('../providers/detect');
const { normalizeModel } = require('./capabilities');
const { getCached, setCached } = require('./cache');

/**
 * Model discovery: fetch the provider's model list, normalize each entry, and
 * cache the result. Uses the cache unless refresh is requested.
 */

function extractRawModels(body) {
  if (!body || typeof body !== 'object') return { list: [], shape: 'unknown' };
  if (Array.isArray(body.data)) return { list: body.data, shape: 'openai' };
  if (Array.isArray(body.models)) return { list: body.models, shape: 'ollama' };
  if (Array.isArray(body)) return { list: body, shape: 'openai' };
  return { list: [], shape: 'unknown' };
}

/**
 * Discover models for the active provider in config.
 *
 * @param {object} config
 * @param {{ refresh?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<{ models: object[], source: string, cached: boolean, retrievedAt: string, expiresAt?: string, error?: string }>}
 */
async function discoverModels(config, options = {}) {
  const { refresh = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (!refresh) {
    const cached = getCached(config);
    if (cached && Array.isArray(cached.models)) {
      return {
        models: cached.models,
        source: cached.source,
        cached: true,
        retrievedAt: cached.retrievedAt,
        expiresAt: cached.expiresAt,
      };
    }
  }

  const modelsPath = config.provider.modelsPath
    || (config.provider.transport === 'ollama-native' ? '/v1/models' : 'models');
  const url = joinURL(config.provider.baseURL, modelsPath);

  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: providerHeaders(config) }, timeoutMs);
    if (!res.ok) {
      return {
        models: [],
        source: 'error',
        cached: false,
        retrievedAt: new Date().toISOString(),
        error: `Provider returned HTTP ${res.status} for ${url}`,
      };
    }

    let body;
    try {
      body = await res.json();
    } catch {
      return {
        models: [],
        source: 'error',
        cached: false,
        retrievedAt: new Date().toISOString(),
        error: 'Provider models response was not valid JSON',
      };
    }

    const { list, shape } = extractRawModels(body);
    const providerName = config.provider.name;
    const models = list
      .map((raw) => normalizeModel(raw, { providerName, shape }))
      .filter((m) => m.id && m.id !== 'unknown');

    const source = shape === 'openai' && list.some((m) => m && (m.pricing || m.context_length !== undefined))
      ? 'provider-metadata'
      : `provider-${shape}`;

    const entry = setCached(config, models, { source });
    return {
      models,
      source: entry.source,
      cached: false,
      retrievedAt: entry.retrievedAt,
      expiresAt: entry.expiresAt,
    };
  } catch (error) {
    return {
      models: [],
      source: 'error',
      cached: false,
      retrievedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

module.exports = {
  extractRawModels,
  discoverModels,
};
