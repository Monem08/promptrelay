'use strict';

const openai = require('./openai-compatible');
const ollama = require('./ollama-native');
const anthropic = require('./anthropic-native');
const logger = require('../telemetry/logger');
const requestLog = require('../telemetry/requests');

/** Best-effort client detection from the User-Agent (metadata only). */
function detectClient(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('claude')) return 'claude-code';
  if (ua.includes('opencode')) return 'opencode';
  if (ua.includes('hermes')) return 'hermes';
  return 'unknown';
}

/** Ingress protocol from the request path. */
function detectIngress(req) {
  const p = String(req.path || req.url || '');
  if (p.includes('/v1/messages')) return 'anthropic';
  if (p.includes('/v1/chat')) return 'openai';
  return 'unknown';
}

/**
 * Attach a one-shot recorder that logs request METADATA after the response
 * finishes. This is deliberately off the proxy hot path (a 'finish'/'close'
 * listener) and records no message content, prompts, or secrets.
 */
function attachRecorder(req, res, config, state) {
  const startedAt = Date.now();
  let done = false;
  const finalize = () => {
    if (done) return;
    done = true;
    try {
      requestLog.record({
        client: detectClient(req),
        ingress: detectIngress(req),
        provider: state.provider || config.provider.name,
        model: state.model || config.provider.model,
        profile: config.reasoning?.auto ? 'auto' : (config.reasoning?.default || 'unknown'),
        status: res.statusCode,
        stream: Boolean(req.body?.stream),
        totalMs: Date.now() - startedAt,
        reasoning: config.reasoning?.auto ? 'auto' : (config.reasoning?.default || 'unknown'),
        fallback: state.fallback,
        retries: state.retries || 0,
        error: res.statusCode >= 400 ? (state.error || `HTTP ${res.statusCode}`) : null,
      });
    } catch {
      // Telemetry is best-effort; never affect the response.
    }
  };
  res.on('finish', finalize);
  res.on('close', finalize);
}

function adapterFor(config) {
  if (config.provider.transport === 'ollama-native') return ollama;
  if (config.provider.transport === 'anthropic-native') return anthropic;
  return openai;
}

/**
 * Build the ordered chain of provider configs to try: the active provider first,
 * then any explicitly configured fallback providers (resolved from the registry).
 * Fallback is opt-in (config.fallback.enabled) and never silent.
 */
function buildChain(config) {
  const chain = [config];
  const fb = config.fallback;
  if (fb && fb.enabled && Array.isArray(fb.providers)) {
    for (const name of fb.providers) {
      const profile = config.providers?.[name];
      if (!profile) {
        logger.warn(`⚠ fallback provider "${name}" is not defined in providers registry — skipping`);
        continue;
      }
      const resolved = {
        ...config,
        provider: { ...profile, apiKey: config.provider.apiKey },
      };
      // Resolve per-provider apiKey from its own env var when specified.
      const envName = profile.apiKeyEnv;
      if (envName && process.env[envName]) {
        resolved.provider.apiKey = process.env[envName];
      }
      chain.push(resolved);
    }
  }
  return chain;
}

/**
 * Dispatch a chat request through the provider chain with explicit fallback.
 */
async function dispatchChat(req, res, config) {
  const chain = buildChain(config);

  const state = { provider: config.provider.name, model: config.provider.model, fallback: false, retries: 0, error: null };
  attachRecorder(req, res, config, state);

  let index = 0;
  const attempt = async () => {
    const current = chain[index];
    const adapter = adapterFor(current);
    const hasNext = index < chain.length - 1;

    // Track which provider/model actually served the request for telemetry.
    state.provider = current.provider.name;
    state.model = current.provider.model;
    if (index > 0) state.fallback = true;

    const options = hasNext
      ? {
          tryNext: async (info) => {
            index += 1;
            state.error = info.error || state.error;
            logger.warn(`↪ falling back to provider "${chain[index].provider.name}" (reason: ${info.error})`);
            await attempt();
            return true;
          },
        }
      : {};

    await adapter.chat(req, res, current, options);
  };

  await attempt();
}

async function dispatchModels(req, res, config) {
  return adapterFor(config).models(req, res, config);
}

module.exports = {
  adapterFor,
  buildChain,
  dispatchChat,
  dispatchModels,
  openai,
  ollama,
  anthropic,
};
