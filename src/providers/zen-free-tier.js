'use strict';

/**
 * OpenCode Zen free-tier support.
 *
 * OpenCode's Zen relay serves its free models (`space-bunny-free`,
 * `mimo-v2.5-free`, `nemotron-*-free`, ...) only to requests that look like
 * they come from the OpenCode client itself. Anything else is rejected:
 *
 *   HTTP 403 {"type":"error","error":{"type":"FreeTierError",
 *            "message":"OpenCode's free tier can only be used from within OpenCode"}}
 *
 * This module supplies the two things the relay actually checks. Both were
 * verified against the live relay; nothing else is required:
 *
 *   1. `User-Agent: opencode/<version>` — the relay's edge returns an HTML
 *      Cloudflare challenge instead of a JSON error when the UA is absent.
 *   2. `x-opencode-session: ses_<26 hex>` — a per-conversation id. The relay
 *      pins a conversation to one backend so its prompt cache stays warm, so
 *      the value must be STABLE across a client's requests, not random per
 *      request. Locally-minted ids are accepted; no server-side registration
 *      call exists.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not require or inject an API key. The anonymous path works; a key
 *     is optional and only switches you onto your own quota (BYOK). Sending a
 *     configured `provider.apiKey` is left entirely to `providerHeaders`.
 *   - It does not rewrite the request body. A `stream: true` body and OpenCode's
 *     title-generator system prompt are *not* required — that was a red herring
 *     from testing against a session id the relay had not yet accepted. A plain
 *     buffered body through this module answers normally.
 *
 * Session ids are minted locally and are NOT secrets: they carry no account,
 * user, or conversation content, and the relay treats them as an opaque
 * cache-affinity hint.
 */

const crypto = require('crypto');

/**
 * User-Agent the relay accepts. Overridable via config so operators can track
 * OpenCode releases without a PromptRelay update — the relay only parses the
 * `opencode/<version>` shape, so any real version string works.
 */
const DEFAULT_USER_AGENT = 'opencode/1.18.34';

/** The exact header name the relay reads. */
const SESSION_HEADER = 'x-opencode-session';

/**
 * Bound on the session pool. Each entry is ~60 bytes; the cap only exists so a
 * hostile or misconfigured client stream cannot grow the map without limit.
 * Oldest insertion is evicted first (Map preserves insertion order).
 */
const MAX_SESSIONS = 512;

const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** clientKey -> { id, touchedAt }. Insertion-ordered for eviction. */
const sessionPool = new Map();

let mintedCount = 0;

/**
 * Mint a relay-shaped session id: `ses_` + 13 random bytes as hex.
 * The shape matches what the OpenCode client sends.
 */
function mintSessionId() {
  return `ses_${crypto.randomBytes(13).toString('hex')}`;
}

/**
 * Resolve a stable pool key for a request.
 *
 * Prefers the detected client id (opencode / claude-code / hermes / unknown)
 * so each agent gets its own conversation affinity, then the peer address so
 * distinct local callers still do not collide. Falls back to a shared key when
 * no request context is available (CLI probes, health checks, model discovery).
 */
function poolKey(context = {}) {
  const clientId = typeof context.clientId === 'string' ? context.clientId.trim() : '';
  if (clientId && clientId !== 'unknown') return `client:${clientId}`;

  const ip = typeof context.ip === 'string' ? context.ip.trim() : '';
  if (ip) return `ip:${ip}`;

  return 'server';
}

/**
 * Get (or lazily mint) the stable session id for a pool key.
 * Idempotent: the same key always returns the same id until it is evicted.
 *
 * @param {object} [context] - { clientId, ip }
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {string}
 */
function sessionFor(context = {}, options = {}) {
  const key = poolKey(context);
  const now = options.now ?? Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_SESSION_TTL_MS;

  const existing = sessionPool.get(key);
  if (existing && now - existing.touchedAt < ttlMs) {
    existing.touchedAt = now;
    // Refresh insertion order so an active client is not the eviction victim.
    sessionPool.delete(key);
    sessionPool.set(key, existing);
    return existing.id;
  }

  const id = mintSessionId();
  mintedCount += 1;
  sessionPool.set(key, { id, touchedAt: now });

  while (sessionPool.size > MAX_SESSIONS) {
    const oldest = sessionPool.keys().next();
    if (oldest.done) break;
    sessionPool.delete(oldest.value);
  }

  return id;
}

/**
 * True when the resolved provider config asks for free-tier header injection.
 * Opt-in per provider so no other provider's wire format changes silently.
 */
function isEnabled(providerConfig = {}) {
  const flag = providerConfig?.zenFreeTier;
  if (flag === true) return true;
  if (!flag || typeof flag !== 'object') return false;
  return flag.enabled !== false;
}

/**
 * Build the free-tier headers for a provider/request pair.
 * Returns an empty object when disabled so callers can merge unconditionally.
 *
 * @param {object} config - resolved PromptRelay config
 * @param {object} [context] - { clientId, ip } request context
 * @returns {Record<string,string>}
 */
function zenFreeTierHeaders(config, context = {}) {
  const provider = config?.provider || {};
  if (!isEnabled(provider)) return {};

  const opts = typeof provider.zenFreeTier === 'object' ? provider.zenFreeTier : {};
  const headers = {};

  // An explicitly configured User-Agent in provider.headers always wins: it is
  // the operator's deliberate choice and may already be correct.
  const configuredUA = provider.headers?.['User-Agent'] || provider.headers?.['user-agent'];
  if (!configuredUA) {
    headers['User-Agent'] = String(opts.userAgent || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
  }

  if (opts.injectSession !== false) {
    headers[SESSION_HEADER] = sessionFor(context, opts);
  }

  return headers;
}

/**
 * Diagnostics for /health and the dashboard. Never exposes the id itself.
 */
function status(config) {
  const provider = config?.provider || {};
  const enabled = isEnabled(provider);
  return {
    enabled,
    sessionHeader: SESSION_HEADER,
    userAgent: enabled
      ? String((typeof provider.zenFreeTier === 'object' && provider.zenFreeTier.userAgent) || DEFAULT_USER_AGENT)
      : null,
    activeSessions: sessionPool.size,
    mintedSessions: mintedCount,
    maxSessions: MAX_SESSIONS,
  };
}

/** Test seam: drop all minted state. */
function _reset() {
  sessionPool.clear();
  mintedCount = 0;
}

module.exports = {
  DEFAULT_USER_AGENT,
  SESSION_HEADER,
  MAX_SESSIONS,
  DEFAULT_SESSION_TTL_MS,
  mintSessionId,
  poolKey,
  sessionFor,
  isEnabled,
  zenFreeTierHeaders,
  status,
  _reset,
};