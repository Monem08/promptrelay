'use strict';

/**
 * URL normalization for provider base URLs.
 *
 * Handles the common mistakes users make when configuring a provider:
 *  - trailing slashes
 *  - missing scheme (assume https, except localhost -> http)
 *  - duplicated /v1 segments (".../v1/v1")
 *  - accidentally appending an endpoint path (".../v1/chat/completions")
 */

const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/completions',
  '/models',
  '/api/chat',
  '/api/tags',
  '/api/generate',
];

/**
 * Basic normalization: trim, add scheme, strip trailing slashes.
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseURL(value) {
  let text = String(value || '').trim();
  if (!text) return '';

  // Add a scheme if the user omitted it.
  if (!/^https?:\/\//i.test(text)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(text);
    text = `${isLocal ? 'http' : 'https'}://${text}`;
  }

  // Strip trailing slashes.
  text = text.replace(/\/+$/, '');
  return text;
}

/**
 * Remove a known endpoint suffix that a user may have pasted into the base URL.
 * @param {string} url
 * @returns {string}
 */
function stripEndpointSuffix(url) {
  let text = String(url || '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ENDPOINT_SUFFIXES) {
      if (text.toLowerCase().endsWith(suffix)) {
        text = text.slice(0, -suffix.length).replace(/\/+$/, '');
        changed = true;
      }
    }
  }
  return text;
}

/**
 * Collapse duplicated /v1 segments: ".../v1/v1" -> ".../v1".
 * @param {string} url
 * @returns {string}
 */
function dedupeVersionSegment(url) {
  return String(url || '').replace(/(\/v1)(\/v1)+/gi, '$1');
}

/**
 * Full normalization used before probing/saving a provider base URL.
 * @param {string} value
 * @returns {string}
 */
function normalizeProviderURL(value) {
  let text = normalizeBaseURL(value);
  if (!text) return '';
  text = stripEndpointSuffix(text);
  text = dedupeVersionSegment(text);
  text = text.replace(/\/+$/, '');
  return text;
}

/**
 * Whether the base URL already ends with a version segment like /v1.
 * @param {string} url
 * @returns {boolean}
 */
function hasVersionSegment(url) {
  return /\/v\d+$/i.test(String(url || ''));
}

/**
 * Join a base URL with a path, de-duplicating a /v1 boundary so that a base of
 * ".../v1" + a path of "v1/models" does not become ".../v1/v1/models".
 * @param {string} baseURL
 * @param {string} p
 * @returns {string}
 */
function joinURL(baseURL, p) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  const rel = String(p || '').replace(/^\/+/, '');
  let joined = `${base}/${rel}`;
  joined = dedupeVersionSegment(joined);
  return joined;
}

/**
 * Produce candidate base URLs to probe when auto-detecting a provider.
 * @param {string} value
 * @returns {string[]}
 */
function candidateBaseURLs(value) {
  const normalized = normalizeProviderURL(value);
  if (!normalized) return [];

  const candidates = new Set([normalized]);
  if (!hasVersionSegment(normalized)) {
    candidates.add(`${normalized}/v1`);
  } else {
    candidates.add(normalized.replace(/\/v\d+$/i, ''));
  }
  return Array.from(candidates);
}

module.exports = {
  ENDPOINT_SUFFIXES,
  normalizeBaseURL,
  normalizeProviderURL,
  stripEndpointSuffix,
  dedupeVersionSegment,
  hasVersionSegment,
  joinURL,
  candidateBaseURLs,
};
