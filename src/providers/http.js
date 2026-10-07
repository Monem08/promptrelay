'use strict';

const { joinURL } = require('./urls');
const { zenFreeTierHeaders } = require('./zen-free-tier');

/**
 * Build upstream request headers, applying the configured auth style.
 * Never logs the key; callers use the telemetry logger for safe output.
 *
 * `context` (optional) carries request identity — `{ clientId, ip }` — so
 * provider features that need per-client state can stay stable across a
 * client's requests. Omit it for non-request callers (CLI probes, health
 * checks, model discovery); those share one pool key.
 */
function providerHeaders(config, context = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(config.provider.headers || {}),
    // Provider-specific wire requirements (e.g. OpenCode Zen free-tier
    // session identity). Applied after operator headers so an explicitly
    // configured header always takes precedence.
    ...zenFreeTierHeaders(config, context),
  };

  const auth = config.provider.auth || { type: 'bearer' };
  const type = String(auth.type || 'bearer').toLowerCase();

  if (type === 'bearer' && config.provider.apiKey) {
    headers.Authorization = `Bearer ${config.provider.apiKey}`;
  } else if (type === 'header' && config.provider.apiKey) {
    headers[auth.headerName || 'x-api-key'] = config.provider.apiKey;
  }

  return headers;
}

/**
 * Resolve which model to send upstream. forceModel pins the configured model;
 * otherwise the client's model is honored unless it is a placeholder.
 */
function resolveModel(incomingModel, config) {
  if (config.provider.forceModel) return config.provider.model;
  if (!incomingModel || incomingModel === 'default' || incomingModel === 'proxy-default') {
    return config.provider.model;
  }
  return incomingModel;
}

/**
 * Derive the identity context that provider headers may key on, from an Express
 * request. Keeps `providerHeaders(config)` call sites honest about whether they
 * have a real client in front of them.
 *
 * @param {object} [req]
 * @returns {{ clientId: string, ip: string }}
 */
function requestContext(req) {
  const clientId = String(req?.headers?.['x-promptrelay-client'] || '').trim()
    || String(req?.headers?.['x-client-name'] || '').trim();
  const ip = String(req?.ip || req?.socket?.remoteAddress || '').trim();
  return { clientId, ip };
}

function createAbortController(req, res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded && !controller.signal.aborted) controller.abort();
  });
  req.on('aborted', () => {
    if (!controller.signal.aborted) controller.abort();
  });
  return controller;
}

function setUpstreamContentType(res, upstream, fallback = 'application/json') {
  res.setHeader('Content-Type', upstream.headers.get('content-type') || fallback);
}

module.exports = {
  providerHeaders,
  requestContext,
  resolveModel,
  createAbortController,
  setUpstreamContentType,
  joinURL,
};
