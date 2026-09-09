'use strict';

const openai = require('./openai-compatible');
const ollama = require('./ollama-native');
const logger = require('../telemetry/logger');

function adapterFor(config) {
  if (config.provider.transport === 'ollama-native') return ollama;
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

  let index = 0;
  const attempt = async () => {
    const current = chain[index];
    const adapter = adapterFor(current);
    const hasNext = index < chain.length - 1;

    const options = hasNext
      ? {
          tryNext: async (info) => {
            index += 1;
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
};
