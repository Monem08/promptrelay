'use strict';

/**
 * Unified IR-level provider egress.
 *
 * Given a NormalizedRequest and a resolved config, this calls the upstream
 * provider using whichever wire protocol the provider speaks, and returns the
 * result back in IR form:
 *
 *   callProviderNonStream(ir, config, hooks) -> NormalizedResponse
 *   callProviderStream(ir, config, hooks)    -> async generator of IR events
 *
 * Supported provider transports: 'openai-compatible', 'anthropic-native'.
 * Anything else throws a CompatibilityError so the caller can return a clear
 * 4xx/501 instead of silently mistranslating.
 *
 * This layer is used both by the anthropic-native egress adapter (OpenAI
 * ingress -> Anthropic provider) and by the /v1/messages ingress (Anthropic
 * ingress -> any supported provider).
 */

const { fetchWithRetry } = require('../adapters/retry');
const { providerHeaders, resolveModel, joinURL } = require('../providers/http');
const oai = require('./openai');
const anth = require('./anthropic');
const { iterSSE } = require('./sse');

class CompatibilityError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CompatibilityError';
    this.statusCode = statusCode;
    this.type = 'promptrelay_compatibility_error';
  }
}

function transportOf(config) {
  return config?.provider?.transport || 'openai-compatible';
}

/** Build the upstream URL + headers + serialized body for the given IR. */
function buildUpstream(ir, config) {
  const transport = transportOf(config);
  const model = resolveModel(ir.model, config);
  const irForProvider = { ...ir, model };

  if (transport === 'openai-compatible') {
    const url = joinURL(config.provider.baseURL, config.provider.chatPath || 'chat/completions');
    const body = oai.irToOpenAIRequest(irForProvider, config);
    body.model = model;
    return { transport, url, headers: providerHeaders(config), body };
  }

  if (transport === 'anthropic-native') {
    const url = joinURL(config.provider.baseURL, config.provider.chatPath || '/v1/messages');
    const body = anth.irToAnthropicRequest(irForProvider, config);
    body.model = model;
    const headers = providerHeaders(config);
    if (!headers['anthropic-version']) headers['anthropic-version'] = anth.ANTHROPIC_VERSION;
    return { transport, url, headers, body };
  }

  throw new CompatibilityError(
    `Provider transport "${transport}" cannot serve this request via the translation layer. ` +
    'Supported transports here are: openai-compatible, anthropic-native.',
    501,
  );
}

async function readError(upstream) {
  let detail = '';
  try { detail = await upstream.text(); } catch { /* noop */ }
  const err = new Error(`Upstream provider returned ${upstream.status}${detail ? `: ${truncate(detail, 500)}` : ''}`);
  err.statusCode = upstream.status;
  err.upstreamBody = detail;
  return err;
}

function truncate(str, n) { return str && str.length > n ? `${str.slice(0, n)}…` : str; }

async function callProviderNonStream(ir, config, hooks = {}) {
  const { transport, url, headers, body } = buildUpstream(ir, config);
  const upstream = await fetchWithRetry(
    url,
    { method: 'POST', headers, body: JSON.stringify({ ...body, stream: false }), signal: hooks.signal },
    config.retry,
    { onRetry: hooks.onRetry || (() => {}) },
  );
  if (!upstream.ok) throw await readError(upstream);
  const json = await upstream.json();
  return transport === 'anthropic-native' ? anth.anthropicResponseToIR(json) : oai.openaiResponseToIR(json);
}

async function* callProviderStream(ir, config, hooks = {}) {
  const { transport, url, headers, body } = buildUpstream(ir, config);
  const upstream = await fetchWithRetry(
    url,
    { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal: hooks.signal },
    config.retry,
    { onRetry: hooks.onRetry || (() => {}) },
  );
  if (!upstream.ok) throw await readError(upstream);
  if (!upstream.body) { yield { type: 'stop', stopReason: null, usage: null }; return; }

  const records = iterSSE(upstream.body);
  const irEvents = transport === 'anthropic-native'
    ? anth.parseAnthropicStream(records)
    : oai.parseOpenAIStream(records);
  yield* irEvents;
}

module.exports = {
  CompatibilityError,
  buildUpstream,
  transportOf,
  callProviderNonStream,
  callProviderStream,
};
