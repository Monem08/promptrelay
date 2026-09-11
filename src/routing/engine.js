'use strict';

/**
 * Runtime routing engine.
 *
 * Single authoritative source for request routing decisions. Shared by:
 *  - OpenAI-compatible ingress (/v1/chat/completions)
 *  - Anthropic Messages ingress (/v1/messages)
 *  - Dashboard test requests
 *  - CLI validation requests
 *
 * Consumes config.routing at dispatch time (hot-reload safe).
 *
 * Routing priority:
 *  1. Per-client routing profile (if client is identified and has a profile)
 *  2. Default routing profile
 *  3. Inline active provider
 *
 * Client identity:
 *  - X-PromptRelay-Client header (preferred, set by client config)
 *  - User-Agent heuristic fallback
 *  - Unknown clients use the default profile
 */

const fs = require('fs');
const logger = require('../telemetry/logger');


/**
 * Detect client identity from a request.
 *
 * @param {object} req - Express request
 * @returns {string} Client identifier (e.g. 'opencode', 'claude-code', 'hermes', 'unknown')
 */
function detectClient(req) {
  // Prefer explicit header (configured by setup into client configs)
  const explicit = req.headers?.['x-promptrelay-client'] || req.headers?.['x-client-name'];
  if (explicit) {
    const id = String(explicit).toLowerCase().trim();
    if (['opencode', 'claude-code', 'hermes'].includes(id)) return id;
  }

  // Fallback to User-Agent heuristic
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('claude')) return 'claude-code';
  if (ua.includes('opencode')) return 'opencode';
  if (ua.includes('hermes')) return 'hermes';
  return 'unknown';
}

/**
 * Detect ingress protocol from the request path.
 */
function detectIngress(req) {
  const p = String(req.path || req.url || '');
  if (p.includes('/v1/messages')) return 'anthropic';
  if (p.includes('/v1/chat')) return 'openai';
  return 'unknown';
}

/**
 * Resolve the routing profile for a given client.
 *
 * @param {string} clientId - Client identifier
 * @param {object} config - Full PromptRelay config
 * @returns {{ profile: string, source: string }}
 */
function resolveProfile(clientId, config) {
  const routing = config.routing || {};
  const clientProfiles = routing.clients || {};

  // Check per-client override
  if (clientId && clientId !== 'unknown' && clientProfiles[clientId]) {
    const clientProfile = clientProfiles[clientId];
    if (clientProfile && clientProfile !== 'inherit') {
      return { profile: clientProfile, source: `client:${clientId}` };
    }
  }

  // Fall back to default routing profile
  const defaultProfile = routing.profile || 'balanced';
  return { profile: defaultProfile, source: 'default' };
}

/**
 * Resolve the preferred provider/model for a client.
 *
 * @param {string} clientId
 * @param {object} config
 * @returns {{ provider: string|null, model: string|null }}
 */
function resolveClientPreferences(clientId, config) {
  const routing = config.routing || {};
  const prefs = routing.clientPreferences || {};
  const clientPref = prefs[clientId];
  if (!clientPref) return { provider: null, model: null };
  return {
    provider: clientPref.provider || null,
    model: clientPref.model || null,
  };
}

/**
 * Build the ordered chain of provider configs for a request.
 *
 * Takes into account:
 *  - Client identity and per-client preferences
 *  - Enabled/disabled providers and models
 *  - Fallback chain from config
 *
 * @param {object} req - Express request
 * @param {object} config - Full config
 * @returns {{ chain: object[], clientId: string, profile: string, profileSource: string }}
 */
function buildRoutingChain(req, config) {
  const clientId = detectClient(req);
  const { profile, source } = resolveProfile(clientId, config);
  const prefs = resolveClientPreferences(clientId, config);
  const routing = config.routing || {};
  const disabledProviders = Array.isArray(routing.disabledProviders) ? routing.disabledProviders : [];
  const disabledModels = Array.isArray(routing.disabledModels) ? routing.disabledModels : [];

  const candidates = [];

  const resolveProvider = (pName, pBlock) => {
    const resolved = {
      ...config,
      provider: { ...pBlock, name: pName, apiKey: config.provider?.apiKey },
    };
    const envName = pBlock.apiKeyEnv;
    if (envName && process.env[envName]) {
      resolved.provider.apiKey = process.env[envName];
    }
    return resolved;
  };

  // 1. Check if client has a preferred provider in clientPreferences
  let preferredAdded = false;
  if (prefs.provider && config.providers?.[prefs.provider] && !disabledProviders.includes(prefs.provider)) {
    const prefBlock = { ...config.providers[prefs.provider] };
    if (prefs.model) prefBlock.model = prefs.model;
    if (!disabledModels.includes(prefBlock.model)) {
      candidates.push(resolveProvider(prefs.provider, prefBlock));
      preferredAdded = true;
    }
  }

  // 2. Add active provider if not disabled and not already added
  if (!preferredAdded || config.provider?.name !== prefs.provider) {
    const activeName = config.provider?.name;
    const isNameDisabled = activeName && disabledProviders.includes(activeName);
    const isModelDisabled = config.provider?.model && disabledModels.includes(config.provider.model);
    if (!isNameDisabled && !isModelDisabled && config.provider) {
      if (prefs.model && !disabledModels.includes(prefs.model)) {
        candidates.push({ ...config, provider: { ...config.provider, model: prefs.model } });
      } else {
        candidates.push(config);
      }
    }
  }

  // 3. Add fallback providers
  const fb = config.fallback;
  if (fb && fb.enabled && Array.isArray(fb.providers)) {
    const seen = new Set(candidates.map((c) => c.provider?.name));
    for (const name of fb.providers) {
      if (seen.has(name)) continue;
      if (disabledProviders.includes(name)) {
        logger.warn(`⚠ fallback provider "${name}" is disabled in routing — skipping`);
        continue;
      }
      const providerProfile = config.providers?.[name];
      if (!providerProfile) {
        logger.warn(`⚠ fallback provider "${name}" is not defined in providers registry — skipping`);
        continue;
      }
      if (providerProfile.model && disabledModels.includes(providerProfile.model)) {
        logger.warn(`⚠ fallback provider "${name}" model "${providerProfile.model}" is disabled — skipping`);
        continue;
      }
      seen.add(name);
      candidates.push(resolveProvider(name, providerProfile));
    }
  }

  // If all preferred/active were disabled, fall back to any enabled registered provider
  if (candidates.length === 0 && config.providers) {
    for (const [name, block] of Object.entries(config.providers)) {
      if (!disabledProviders.includes(name) && !disabledModels.includes(block.model)) {
        candidates.push(resolveProvider(name, block));
        break;
      }
    }
  }

  // Fallback to active config if still empty
  if (candidates.length === 0) {
    candidates.push(config);
  }

  // 4. Health-aware re-ordering: if multiple candidates, deprioritize known unhealthy providers
  let chain = candidates;
  try {
    const healthFile = config.paths?.healthFile;
    if (healthFile && fs.existsSync(healthFile) && chain.length > 1) {
      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8').replace(/^\uFEFF/, ''));
      const isUnhealthy = (c) => {
        const h = healthData[c.provider?.name];
        return h && h.ok === false;
      };
      const healthy = chain.filter((c) => !isUnhealthy(c));
      const unhealthy = chain.filter((c) => isUnhealthy(c));
      if (healthy.length > 0 && unhealthy.length > 0) {
        chain = [...healthy, ...unhealthy];
      }
    }
  } catch {}

  // 5. Capability constraints: if request specifies tools or vision, filter or rank capable providers first
  if (req && req.body && chain.length > 1) {
    const body = req.body;
    const needsTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasImages = (msgs) => Array.isArray(msgs) && msgs.some((m) => {
      if (Array.isArray(m.content)) return m.content.some((b) => b.type === 'image' || b.type === 'image_url');
      return false;
    });
    const needsVision = hasImages(body.messages);

    if (needsTools || needsVision) {
      const capable = chain.filter((c) => {
        if (needsVision && c.provider?.capabilities && c.provider.capabilities.vision === false) return false;
        if (needsTools && c.provider?.capabilities && c.provider.capabilities.tools === false) return false;
        return true;
      });
      if (capable.length > 0) {
        chain = capable;
      }
    }
  }

  return { chain, clientId, profile, profileSource: source };
}


/**
 * Create a telemetry state tracker for a request.
 */
function createRequestState(config, clientId, profile) {
  return {
    provider: config.provider.name,
    model: config.provider.model,
    client: clientId,
    profile,
    fallback: false,
    retries: 0,
    error: null,
    providerAttempts: 1,
    ttftMs: 'unknown',
    tokens: 'unknown',
  };
}

module.exports = {
  detectClient,
  detectIngress,
  resolveProfile,
  resolveClientPreferences,
  buildRoutingChain,
  createRequestState,
};
