'use strict';

/**
 * Secret management: masked display and log redaction.
 *
 * PromptRelay never prints raw API keys. Secrets are masked for display and
 * redacted from any structured value that might be logged.
 */

// Common secret-bearing key names (case-insensitive substring match).
const SECRET_KEY_HINTS = [
  'apikey',
  'api_key',
  'authorization',
  'auth_token',
  'token',
  'secret',
  'password',
  'passwd',
  'bearer',
  'x-api-key',
  'access_key',
  'client_secret',
];

/**
 * Mask a secret for display, keeping a short prefix/suffix so users can
 * confirm which key is configured without exposing it.
 *
 * @param {string} value
 * @param {{ visible?: number }} [options]
 * @returns {string}
 */
function maskSecret(value, options = {}) {
  const text = value == null ? '' : String(value);
  if (!text) return '(not set)';

  const visible = Number.isInteger(options.visible) ? options.visible : 4;
  if (text.length <= visible + 2) {
    return '*'.repeat(text.length);
  }

  const head = text.slice(0, visible);
  const tail = text.slice(-2);
  const hiddenLength = Math.max(4, text.length - visible - 2);
  return `${head}${'*'.repeat(Math.min(hiddenLength, 24))}${tail}`;
}

function looksLikeSecretKey(key) {
  const lower = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_HINTS.some((hint) => lower.includes(hint.replace(/[^a-z0-9]/g, '')));
}

/**
 * Redact a "Bearer <token>" style header value.
 * @param {string} value
 * @returns {string}
 */
function redactAuthHeader(value) {
  const text = String(value || '');
  const bearer = text.match(/^\s*Bearer\s+(.+)$/i);
  if (bearer) return `Bearer ${maskSecret(bearer[1])}`;
  return maskSecret(text);
}

/**
 * Recursively redact secret-bearing fields from an object/array for safe logging.
 * Returns a deep copy; the original is never mutated.
 *
 * @param {*} value
 * @param {{ extraKeys?: string[], seen?: WeakSet }} [options]
 * @returns {*}
 */
function redact(value, options = {}) {
  const extra = (options.extraKeys || []).map((k) => String(k).toLowerCase());
  const seen = options.seen || new WeakSet();

  const isSecretKey = (key) => looksLikeSecretKey(key) || extra.includes(String(key).toLowerCase());

  const walk = (node) => {
    if (node == null) return node;
    if (typeof node !== 'object') return node;
    if (seen.has(node)) return '[Circular]';
    seen.add(node);

    if (Array.isArray(node)) return node.map(walk);

    const out = {};
    for (const [key, val] of Object.entries(node)) {
      if (isSecretKey(key) && (typeof val === 'string' || typeof val === 'number')) {
        out[key] = maskSecret(val);
      } else if (key.toLowerCase() === 'authorization' && typeof val === 'string') {
        out[key] = redactAuthHeader(val);
      } else {
        out[key] = walk(val);
      }
    }
    return out;
  };

  return walk(value);
}

/**
 * Redact known secret substrings from a free-form string (e.g. an error message).
 * @param {string} text
 * @param {string[]} secrets - the literal secret values to scrub
 * @returns {string}
 */
function redactString(text, secrets = []) {
  let out = String(text == null ? '' : text);
  for (const secret of secrets) {
    if (!secret || String(secret).length < 6) continue;
    const literal = String(secret);
    out = out.split(literal).join(maskSecret(literal));
  }
  // Scrub anything that looks like a Bearer token in the string.
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, (m) => redactAuthHeader(m));
  return out;
}

module.exports = {
  SECRET_KEY_HINTS,
  maskSecret,
  looksLikeSecretKey,
  redactAuthHeader,
  redact,
  redactString,
};
