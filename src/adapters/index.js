'use strict';

const openai = require('./openai-compatible');
const ollama = require('./ollama-native');
const anthropic = require('./anthropic-native');
const logger = require('../telemetry/logger');
const requestLog = require('../telemetry/requests');
const routing = require('../routing/engine');

/**
 * Attach a one-shot recorder that logs request METADATA after the response
 * finishes. This is deliberately off the proxy hot path (a 'finish'/'close'
 * listener) and records no message content, prompts, or secrets.
 *
 * Respects logging mode: 'off' records nothing new.
 */
function attachRecorder(req, res, config, state) {
  const startedAt = Date.now();
  let done = false;
  const finalize = () => {
    if (done) return;
    done = true;
    // Respect logging mode
    if (config.logging?.mode === 'off') return;
    try {
      requestLog.record({
        client: state.client || routing.detectClient(req),
        ingress: routing.detectIngress(req),
        provider: state.provider || config.provider.name,
        model: state.model || config.provider.model,
        profile: state.profile || (config.routing?.profile) || 'unknown',
        status: res.statusCode,
        stream: Boolean(req.body?.stream),
        totalMs: Date.now() - startedAt,
        ttftMs: state.ttftMs || 'unknown',
        reasoning: config.reasoning?.auto ? 'auto' : (config.reasoning?.default || 'unknown'),
        fallback: state.fallback,
        retries: state.retries || 0,
        providerAttempts: state.providerAttempts || 1,
        tokens: state.tokens || 'unknown',
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
 * Build the ordered chain of provider configs to try using the routing engine.
 * Uses per-client routing when a client identity is available.
 */
function buildChain(config, req) {
  if (req) {
    return routing.buildRoutingChain(req, config);
  }
  // Fallback: no request context (e.g. CLI validation)
  const chain = [config];
  const fb = config.fallback;
  if (fb && fb.enabled && Array.isArray(fb.providers)) {
    const seen = new Set([config.provider.name]);
    for (const name of fb.providers) {
      if (seen.has(name)) continue;
      seen.add(name);
      const profile = config.providers?.[name];
      if (!profile) {
        logger.warn(`⚠ fallback provider "${name}" is not defined in providers registry — skipping`);
        continue;
      }
      const resolved = {
        ...config,
        provider: { ...profile, apiKey: config.provider.apiKey },
      };
      const envName = profile.apiKeyEnv;
      if (envName && process.env[envName]) {
        resolved.provider.apiKey = process.env[envName];
      }
      chain.push(resolved);
    }
  }
  return { chain, clientId: 'unknown', profile: config.routing?.profile || 'balanced', profileSource: 'default' };
}

/**
 * Dispatch a chat request through the provider chain with explicit fallback.
 * Uses the routing engine for per-client routing and consistent telemetry.
 */
async function dispatchChat(req, res, config) {
  const { chain, clientId, profile } = buildChain(config, req);

  const state = routing.createRequestState(config, clientId, profile);
  attachRecorder(req, res, config, state);

  let index = 0;
  const attempt = async () => {
    const current = chain[index];
    const adapter = adapterFor(current);
    const hasNext = index < chain.length - 1;

    // Track which provider/model actually served the request for telemetry.
    state.provider = current.provider.name;
    state.model = current.provider.model;
    if (index > 0) {
      state.fallback = true;
      state.providerAttempts = index + 1;
    }

    const options = {
      clientId,
      state,
      ...(hasNext
        ? {
            tryNext: async (info) => {
              index += 1;
              state.error = info.error || state.error;
              logger.warn(`↪ falling back to provider "${chain[index].provider.name}" (reason: ${info.error})`);
              await attempt();
              return true;
            },
          }
        : {}),
    };

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

