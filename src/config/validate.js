'use strict';

const { PROMPT_MODES, TRANSPORTS, AUTH_TYPES, REASONING_LEVELS } = require('./schema');

/**
 * Validate a resolved config object. Returns an array of human-readable
 * problem strings (empty when valid). Designed to produce helpful, specific
 * messages rather than generic failures.
 *
 * @param {object} config
 * @returns {string[]}
 */
function validateConfig(config) {
  const problems = [];

  if (!config || typeof config !== 'object') {
    return ['config must be an object'];
  }

  const provider = config.provider || {};
  const prompt = config.prompt || {};
  const server = config.server || {};

  if (!provider.baseURL) {
    problems.push('provider.baseURL is required (e.g. https://openrouter.ai/api/v1)');
  }
  if (!provider.model) {
    problems.push('provider.model is required (run `promptrelay models list` to choose one)');
  }
  if (!TRANSPORTS.includes(provider.transport)) {
    problems.push(`provider.transport must be one of: ${TRANSPORTS.join(', ')}`);
  }
  if (!PROMPT_MODES.includes(prompt.mode)) {
    problems.push(`prompt.mode must be one of: ${PROMPT_MODES.join(', ')}`);
  }
  if (!Number.isFinite(server.port) || server.port <= 0 || server.port > 65535) {
    problems.push('server.port must be a number between 1 and 65535');
  }

  const authType = String(provider.auth?.type || 'bearer').toLowerCase();
  if (!AUTH_TYPES.includes(authType)) {
    problems.push(`provider.auth.type must be one of: ${AUTH_TYPES.join(', ')}`);
  }
  if (authType === 'header' && !provider.auth?.headerName) {
    problems.push('provider.auth.headerName is required when auth.type is "header"');
  }

  if (provider.headers && (typeof provider.headers !== 'object' || Array.isArray(provider.headers))) {
    problems.push('provider.headers must be an object of header name/value pairs');
  }

  const reasoning = config.reasoning || {};
  if (reasoning.default && !REASONING_LEVELS.includes(String(reasoning.default).toLowerCase())) {
    // Not fatal: aliases resolve elsewhere. Only warn on clearly invalid values below.
  }

  if (config.retry) {
    const r = config.retry;
    if (r.maxRetries !== undefined && (!Number.isInteger(r.maxRetries) || r.maxRetries < 0)) {
      problems.push('retry.maxRetries must be a non-negative integer');
    }
    if (r.retryableStatus !== undefined && !Array.isArray(r.retryableStatus)) {
      problems.push('retry.retryableStatus must be an array of HTTP status codes');
    }
  }

  if (config.fallback && config.fallback.enabled) {
    if (!Array.isArray(config.fallback.providers) || config.fallback.providers.length === 0) {
      problems.push('fallback.enabled is true but fallback.providers is empty');
    }
  }

  return problems;
}

module.exports = { validateConfig };
