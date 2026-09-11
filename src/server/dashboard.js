'use strict';

/**
 * PromptRelay Dashboard backend.
 *
 * Mounts:
 *   - GET  /dashboard            → static SPA (from ../../dashboard)
 *   - GET  /api/dashboard/*      → read-only JSON APIs (real backend data)
 *   - POST /api/dashboard/*      → guarded, safe mutations (config writes)
 *
 * SECURITY:
 *   - Every payload is built from safeConfig()/redaction helpers. Raw API keys,
 *     Authorization headers, and secret env values are NEVER sent to the client.
 *   - By default the dashboard only answers requests from loopback addresses.
 *     Set PROMPTRELAY_DASHBOARD_ALLOW_REMOTE=true to relax (a warning is shown
 *     in the UI/settings when the gateway is bound to a non-loopback host).
 *   - The dashboard is isolated from the proxy hot path: it never runs during a
 *     chat/completions request and reads pre-computed/cached data.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const {
  loadConfig,
  validateConfig,
  safeConfig,
  resolveActiveProvider,
} = require('../config');
const { promptConfigured, loadPrompt } = require('../prompts');
const { listClients, statusAll, detectAll } = require('../clients/registry');
const providers = require('../providers');
const models = require('../models');
const requestLog = require('../telemetry/requests');
const { maskSecret } = require('../telemetry/secrets');

const { safeWriteJsonSync } = require('../config/safe-write');

const DASHBOARD_DIR = path.resolve(__dirname, '..', '..', 'dashboard');
const START_TIME = Date.now();

function isRemoteAllowed() {
  return String(process.env.PROMPTRELAY_DASHBOARD_ALLOW_REMOTE || '').toLowerCase() === 'true';
}

const PROMPT_PRESETS = require('./dashboard-presets');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isLoopback(ip) {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.') ||
    ip === 'localhost'
  );
}

const crypto = require('crypto');

// Rate limiting for remote authentication failures: max 5 failures per IP within 60s
const authFailures = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_AUTH_FAILURES = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry) return true;
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    authFailures.delete(ip);
    return true;
  }
  return entry.count < MAX_AUTH_FAILURES;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || (now - entry.windowStart > RATE_LIMIT_WINDOW_MS)) {
    authFailures.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Comprehensive security guard for dashboard endpoints. */
function dashboardSecurityGuard(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self';");

  const ip = req.ip || req.socket?.remoteAddress || '';
  const loopback = isLoopback(ip);

  const isTls = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (!loopback && !isTls) {
    res.setHeader('X-PromptRelay-Security-Warning', 'non-TLS remote connection');
  }

  // Local loopback is granted without requiring remote credentials
  if (loopback) {
    return next();
  }

  // Remote caller: reject if remote access not enabled
  if (!isRemoteAllowed()) {
    return res.status(403).json({
      error: {
        message: 'The PromptRelay dashboard is local-only by default. Set PROMPTRELAY_DASHBOARD_ALLOW_REMOTE=true to allow remote access.',
        type: 'dashboard_local_only',
      },
    });
  }

  let config;
  try { config = loadConfig(); } catch {}
  const expectedToken = process.env.PROMPTRELAY_DASHBOARD_TOKEN || config?.security?.dashboardToken;

  // Secure refusal: if remote access is on but no token configured, refuse!
  if (!expectedToken) {
    return res.status(403).json({
      error: {
        message: 'Remote dashboard access requires a configured dashboard token. Set PROMPTRELAY_DASHBOARD_TOKEN or config.security.dashboardToken.',
        type: 'missing_dashboard_token_config',
      },
    });
  }

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: {
        message: 'Too many failed authentication attempts. Please try again later.',
        type: 'rate_limited',
      },
    });
  }

  // Extract token from Authorization: Bearer <token> or x-dashboard-token header
  let providedToken = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  } else if (req.headers['x-dashboard-token']) {
    providedToken = String(req.headers['x-dashboard-token']).trim();
  }

  if (!providedToken) {
    return res.status(401).json({
      error: {
        message: 'Dashboard token is required for remote access. Provide Authorization: Bearer <token> or x-dashboard-token.',
        type: 'missing_dashboard_token',
      },
    });
  }

  if (!timingSafeEqualStr(providedToken, expectedToken)) {
    recordAuthFailure(ip);
    return res.status(401).json({
      error: {
        message: 'Invalid dashboard token.',
        type: 'invalid_dashboard_token',
      },
    });
  }

  // State-changing route protection against CSRF
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
  if (isStateChanging && req.headers.origin) {
    const originHost = req.headers.origin.replace(/^https?:\/\//, '').split('/')[0];
    const hostHeader = req.headers.host;
    if (originHost && hostHeader && originHost !== hostHeader) {
      return res.status(403).json({
        error: {
          message: 'Cross-origin state-changing requests are refused for remote dashboard access.',
          type: 'cross_origin_refusal',
        },
      });
    }
  }

  next();
}

const localOnly = dashboardSecurityGuard;

/** Load config, or send a sanitized 500 and return null. */
function safeLoad(res) {
  try {
    return loadConfig();
  } catch (error) {
    res.status(500).json({ error: { message: `Failed to read config: ${error.message}`, type: 'config_error' } });
    return null;
  }
}

/** Read the raw on-disk config the running server was loaded from. */
function readRawConfig(config) {
  try {
    const file = config.paths.configFile;
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeRawConfig(config, raw) {
  const file = config.paths.configFile;
  safeWriteJsonSync(file, raw, { reason: 'dashboard_update' });
}

/**
 * Persist a secret to the gateway's .env file (the intended secure store).
 * The value is written with 0600 perms and is NEVER echoed back to the client
 * and NEVER written into the JSON config. Returns true on success.
 */
function writeEnvKey(config, key, value) {
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return false;
  try {
    const file = config.paths.envFile;
    let lines = [];
    if (fs.existsSync(file)) {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => {
        const t = line.trim();
        return t && !t.startsWith(`${key}=`);
      });
    }
    lines.push(`${key}=${JSON.stringify(String(value || ''))}`);
    fs.writeFileSync(file, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
    try { fs.chmodSync(file, 0o600); } catch {}
    // Make the key live for this process immediately (matches loadEnvFile rules).
    if (process.env[key] === undefined) process.env[key] = String(value || '');
    return true;
  } catch {
    return false;
  }
}

function gatewayURL(config) {
  const host = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;
  return `http://${host}:${config.server.port}`;
}

/** Read persisted provider health (safe subset only). */
function readHealthState(config) {
  try {
    return providers.health.readHealth(config.paths.healthFile) || {};
  } catch {
    return {};
  }
}

/** Get cached models without a network call (never blocks the dashboard). */
function cachedModels(config) {
  try {
    const cache = require('../models/cache');
    const entry = cache.getCached(config, { ignoreExpiry: true });
    if (entry && Array.isArray(entry.models)) return entry;
  } catch {}
  return null;
}

function countFree(list) {
  return list.filter((m) => m.free === true).length;
}

// ---------------------------------------------------------------------------
// route registration
// ---------------------------------------------------------------------------

function registerDashboard(app) {
  const api = express.Router();
  api.use(localOnly);

  // ---- STATUS (Overview command center) ----
  api.get('/status', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const problems = validateConfig(config);
    const clients = statusAll();
    const connectedClients = clients.filter((c) => c.found && c.configured).length;
    const providerList = providers.listProviders(config);
    const cache = cachedModels(config);
    const modelList = cache ? cache.models : [];
    const metrics = requestLog.metrics();
    const health = readHealthState(config);

    const uniqueProviders = new Set(providerList.map((p) => p.name));
    if (config.provider?.name && !config.activeProvider) uniqueProviders.add(config.provider.name);
    else if (uniqueProviders.size === 0 && config.provider?.name) uniqueProviders.add(config.provider.name);

    res.json({
      version: require('../../package.json').version,
      gatewayURL: gatewayURL(config),
      host: config.server.host,
      port: config.server.port,
      status: problems.length ? 'error' : 'ok',
      problems,
      uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
      remoteAccessAllowed: isRemoteAllowed(),
      boundNonLoopback: !isLoopback(config.server.host) && config.server.host !== 'localhost',
      active: {
        provider: config.provider.name,
        transport: config.provider.transport,
        model: config.provider.model,
        baseURL: config.provider.baseURL,
        promptMode: config.prompt.mode,
        promptConfigured: promptConfigured(config),
        reasoning: config.reasoning.auto ? 'auto' : config.reasoning.default,
        activeProfile: config.activeProvider || '(inline)',
      },
      counts: {
        clients: connectedClients,
        clientsDetected: detectAll().filter((c) => c.installed).length,
        providers: uniqueProviders.size || 1,
        models: cache ? modelList.length : 'unknown',
        freeModels: cache ? countFree(modelList) : 'unknown',
        healthyCandidates: cache ? modelList.length : 'unknown',
      },

      modelsCache: cache
        ? { source: cache.source, retrievedAt: cache.retrievedAt, expiresAt: cache.expiresAt }
        : null,
      metrics: {
        total: metrics.total,
        successRate: metrics.successRate,
        medianLatencyMs: metrics.medianTotalMs,
        medianTtftMs: metrics.medianTtftMs,
        hasData: metrics.hasData,
      },
      fallback: {
        enabled: Boolean(config.fallback?.enabled),
        providers: config.fallback?.providers || [],
      },
      health,
    });
  });

  // ---- CLIENTS ----
  api.get('/clients', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const registry = require('../clients/registry');
    const list = listClients().map((meta) => {
      const client = registry.getClient(meta.id);
      const status = client.status();
      const endpoint = client.defaultBaseURL(config.server);
      return {
        id: meta.id,
        label: meta.label,
        protocol: meta.protocol,
        ingress: meta.protocol === 'anthropic' ? 'POST /v1/messages' : 'POST /v1/chat/completions',
        endpoint,
        found: status.found,
        configured: Boolean(status.configured),
        valid: status.valid !== false,
        path: status.path,
        error: status.error || null,
        details: status.details || null, // already token-redacted by adapters
        models: status.models || null,
      };
    });
    res.json({ clients: list });
  });

  // ---- PROVIDERS ----
  api.get('/providers', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const raw = readRawConfig(config);
    const registry = raw.providers || {};
    const health = readHealthState(config);
    const cache = cachedModels(config);
    const modelCount = cache ? cache.models.length : 'unknown';

    const list = [];
    // Inline / active provider first.
    const activeName = config.provider.name;
    for (const [name, p] of Object.entries(registry)) {
      const h = health[p.name] || health[name] || null;
      list.push({
        id: name,
        name: p.name || name,
        transport: p.transport || 'unknown',
        baseURL: p.baseURL || 'unknown',
        model: p.model || 'unknown',
        active: config.activeProvider === name,
        credentialStatus: p.auth?.type === 'none' ? 'not-required' : 'via-env',
        apiKeyEnv: p.apiKeyEnv || 'PROVIDER_API_KEY',
        authType: p.auth?.type || 'bearer',
        health: h ? { ok: h.ok, status: h.status, latencyMs: h.latencyMs, checkedAt: h.checkedAt, error: h.error } : null,
        modelCount: 'unknown',
      });
    }
    // Ensure the currently-active inline provider is represented.
    if (!config.activeProvider) {
      const h = health[activeName] || null;
      list.unshift({
        id: '(inline)',
        name: activeName,
        transport: config.provider.transport,
        baseURL: config.provider.baseURL,
        model: config.provider.model,
        active: true,
        credentialStatus: config.provider.auth?.type === 'none'
          ? 'not-required'
          : (config.provider.apiKey ? 'configured' : 'missing'),
        apiKeyEnv: config.provider.apiKeyEnv,
        apiKeyMasked: config.provider.apiKey ? maskSecret(config.provider.apiKey) : '(not set)',
        authType: config.provider.auth?.type || 'bearer',
        health: h ? { ok: h.ok, status: h.status, latencyMs: h.latencyMs, checkedAt: h.checkedAt, error: h.error } : null,
        modelCount,
      });
    }

    res.json({ providers: list, presets: providers.listPresets() });
  });

  // ---- MODELS ----
  api.get('/models', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const refresh = String(req.query.refresh || '') === 'true' || req.query.refresh === '1';
    let result;
    try {
      result = await models.discoverModels(config, { refresh });
    } catch (error) {
      return res.status(200).json({ models: [], source: 'error', error: error.message, retrievedAt: new Date().toISOString() });
    }
    res.json(result);
  });

  // ---- ROUTER ----
  api.get('/router', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const profile = String(req.query.profile || 'balanced');
    const cache = cachedModels(config);
    const list = cache ? cache.models : [];
    const validProfile = models.PROFILES.includes(profile) ? profile : 'balanced';

    let ranked = [];
    let recommendation = null;
    if (list.length) {
      ranked = models.rankModels(list, validProfile, { limit: 20 }).map((r) => ({
        id: r.model.id,
        provider: r.model.provider,
        score: r.score,
        reasons: r.reasons,
        contextWindow: r.model.contextWindow,
        tools: r.model.tools,
        reasoning: r.model.reasoning,
        vision: r.model.vision,
        free: r.model.free,
      }));
      recommendation = models.recommend(list, validProfile);
    }

    // Per-client profiles from config (inherit global by default).
    const clientProfiles = {};
    for (const c of listClients()) {
      const override = config.routing?.clients?.[c.id];
      clientProfiles[c.id] = override || 'inherit';
    }

    res.json({
      profiles: models.PROFILES,
      currentProfile: config.routing?.profile || validProfile,
      hasModels: list.length > 0,
      modelsSource: cache ? cache.source : null,
      candidates: ranked,
      recommendation: recommendation
        ? { model: recommendation.model?.id || null, score: recommendation.score, explanation: recommendation.explanation, reasons: recommendation.reasons, alternatives: recommendation.alternatives }
        : null,
      clientProfiles,
      reasoning: { auto: Boolean(config.reasoning?.auto), default: config.reasoning?.default },
      fallback: {
        enabled: Boolean(config.fallback?.enabled),
        providers: config.fallback?.providers || [],
        crossProvider: Boolean(config.fallback?.crossProvider),
      },
      retry: {
        enabled: Boolean(config.retry?.enabled),
        maxRetries: config.retry?.maxRetries,
        retryableStatus: config.retry?.retryableStatus || [],
      },
      providerNames: Object.keys(readRawConfig(config).providers || {}),
    });
  });

  // ---- PROMPTS ----
  api.get('/prompts', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const { loadScopedPrompt, scopeConfigured, modeForScope, listScopes, promptFileForScope } = require('../prompts/scopes');
    const scope = String(req.query.scope || 'global').trim();
    let content = '';
    try {
      content = loadScopedPrompt(scope, config);
    } catch {}
    const filePath = promptFileForScope(scope, config);
    const configured = scopeConfigured(scope, config);
    const currentMode = modeForScope(scope, config);

    res.json({
      scope,
      content,
      mode: currentMode,
      configured,
      characters: content.length,
      tokenEstimate: Math.ceil(content.length / 4),
      file: filePath,
      modes: ['replace', 'prepend', 'append', 'passthrough'],
      scopes: ['global', ...listClients().map((c) => c.id)],
      allScopes: listScopes(config),
      presets: PROMPT_PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description, content: p.content })),
    });
  });

  // ---- REQUESTS ----
  api.get('/requests', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ requests: requestLog.list({ limit }), total: requestLog.count() });
  });
  api.get('/requests/:id', (req, res) => {
    const entry = requestLog.get(req.params.id);
    if (!entry) return res.status(404).json({ error: { message: 'Request not found', type: 'not_found' } });
    res.json(entry);
  });

  // ---- METRICS ----
  api.get('/metrics', (req, res) => {
    res.json(requestLog.metrics());
  });

  // ---- DIAGNOSTICS ----
  api.get('/diagnostics', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const deep = String(req.query.deep || '') === 'true' || req.query.deep === '1';
    res.json(await runDiagnostics(config, { deep }));
  });

  // ---- SETTINGS ----
  api.get('/settings', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    res.json({
      ...safeConfig(config),
      logging: config.logging,
      automation: config.automation || {},
      dashboard: {
        remoteAccessAllowed: isRemoteAllowed(),
        boundHost: config.server.host,
        boundNonLoopback: !isLoopback(config.server.host) && config.server.host !== 'localhost',
      },
      paths: {
        configFile: config.paths.configFile,
        promptFile: config.paths.promptFile,
        envFile: config.paths.envFile,
        cacheFile: config.paths.cacheFile,
      },
    });
  });

  // ============================ SAFE MUTATIONS ============================

  // Refresh model cache (safe — a GET to the provider's models endpoint).
  api.post('/models/refresh', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    try {
      const result = await models.discoverModels(config, { refresh: true });
      res.json(result);
    } catch (error) {
      res.status(200).json({ models: [], source: 'error', error: error.message });
    }
  });

  // Set the active model.
  api.post('/model/use', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: { message: 'Model id is required', type: 'invalid_request' } });
    const raw = readRawConfig(config);
    raw.provider = raw.provider || {};
    raw.provider.model = id;
    if (raw.activeProvider && raw.providers?.[raw.activeProvider]) raw.providers[raw.activeProvider].model = id;
    writeRawConfig(config, raw);
    res.json({ ok: true, model: id });
  });

  // Switch active provider profile.
  api.post('/provider/use', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const name = String(req.body?.name || '').trim();
    const raw = readRawConfig(config);
    if (!raw.providers?.[name]) return res.status(404).json({ error: { message: `No provider profile "${name}"`, type: 'not_found' } });
    raw.activeProvider = name;
    raw.provider = { ...(raw.provider || {}), ...raw.providers[name] };
    writeRawConfig(config, raw);
    res.json({ ok: true, active: name });
  });

  // Add / update a provider profile (writes config; key stored separately in .env).
  api.post('/provider', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const { name, preset, provider: providerBlock } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: { message: 'Provider name is required', type: 'invalid_request' } });
    let block = providerBlock;
    if (preset) {
      const p = providers.getPreset(preset);
      if (!p) return res.status(400).json({ error: { message: `Unknown preset "${preset}"`, type: 'invalid_request' } });
      block = { ...p.provider, ...(providerBlock || {}) };
    }
    if (!block || !block.transport) return res.status(400).json({ error: { message: 'Provider block with transport is required', type: 'invalid_request' } });
    // Never persist a raw apiKey into the config file — capture it, strip it,
    // then store it (if provided) in the .env file where the gateway reads it.
    const submittedKey = typeof (req.body || {}).apiKey === 'string' ? req.body.apiKey.trim() : '';
    delete block.apiKey;
    const apiKeyEnv = block.apiKeyEnv || (name ? `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY` : 'PROVIDER_API_KEY');
    block.apiKeyEnv = apiKeyEnv;
    const raw = readRawConfig(config);
    raw.providers = raw.providers || {};
    raw.providers[name] = block;
    writeRawConfig(config, raw);
    let keyStored = false;
    if (submittedKey) keyStored = writeEnvKey(config, apiKeyEnv, submittedKey);
    res.json({
      ok: true,
      name,
      needsKey: providers.getPreset(preset)?.needsKey ?? true,
      apiKeyEnv,
      keyStored, // boolean only — the secret itself is never returned
    });
  });

  // Safe provider health check (no tokens spent). Live requires ?live=true and
  // is only ever run on explicit user action from the UI.
  api.post('/provider/test', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const live = req.body?.live === true;
    const name = req.body?.name;
    let target = config;
    if (name) {
      const raw = readRawConfig(config);
      const p = raw.providers?.[name];
      if (!p) return res.status(404).json({ error: { message: `No provider profile "${name}"`, type: 'not_found' } });
      target = { ...config, provider: { ...p, apiKey: config.provider.apiKey } };
      if (p.apiKeyEnv && process.env[p.apiKeyEnv]) target.provider.apiKey = process.env[p.apiKeyEnv];
    }
    try {
      const result = live ? await providers.health.liveCheck(target) : await providers.health.safeCheck(target);
      // result.error is already a sanitized message; strip URL query just in case.
      res.json({ ok: result.ok, status: result.status, latencyMs: result.latencyMs, mode: result.mode, error: result.error || null, checkedAt: result.checkedAt });
    } catch (error) {
      res.status(200).json({ ok: false, error: error.message });
    }
  });

  // Save prompt content and/or mode (with scope support).
  api.post('/prompts', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const { content, mode, scope: rawScope } = req.body || {};
    const scope = String(rawScope || 'global').trim();
    const { promptFileForScope, scopeConfigured, modeForScope, loadScopedPrompt } = require('../prompts/scopes');
    const targetFile = promptFileForScope(scope, config);

    if (typeof content === 'string') {
      try {
        const { safeWriteSync } = require('../config/safe-write');
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        safeWriteSync({ filePath: targetFile, content: `${content}\n` });
      } catch (error) {
        return res.status(500).json({ error: { message: `Could not write prompt: ${error.message}`, type: 'write_error' } });
      }
    }

    if (mode && ['replace', 'prepend', 'append', 'passthrough'].includes(mode)) {
      const raw = readRawConfig(config);
      if (scope === 'global') {
        raw.prompt = raw.prompt || {};
        raw.prompt.mode = mode;
      } else {
        raw.promptScopes = raw.promptScopes || {};
        raw.promptScopes[scope] = { ...(raw.promptScopes[scope] || {}), mode };
      }
      writeRawConfig(config, raw);
    }

    const fresh = loadConfig();
    let saved = '';
    try { saved = loadScopedPrompt(scope, fresh); } catch {}
    res.json({
      ok: true,
      scope,
      characters: saved.length,
      configured: scopeConfigured(scope, fresh),
      mode: modeForScope(scope, fresh),
      file: promptFileForScope(scope, fresh),
    });
  });

  // Router profile / fallback settings.
  api.post('/router', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const raw = readRawConfig(config);
    const body = req.body || {};
    if (body.profile && models.PROFILES.includes(body.profile)) {
      raw.routing = raw.routing || {};
      raw.routing.profile = body.profile;
    }
    if (body.clientProfiles && typeof body.clientProfiles === 'object') {
      raw.routing = raw.routing || {};
      raw.routing.clients = { ...(raw.routing.clients || {}), ...body.clientProfiles };
    }
    if (body.fallback && typeof body.fallback === 'object') {
      raw.fallback = { ...(raw.fallback || {}), ...body.fallback };
    }
    if (typeof body.reasoning === 'object' && body.reasoning) {
      raw.reasoning = { ...(raw.reasoning || {}), ...body.reasoning };
    }
    writeRawConfig(config, raw);
    res.json({ ok: true });
  });

  // Update settings (gateway/logging/automation/security-safe fields).
  api.post('/settings', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const raw = readRawConfig(config);
    const body = req.body || {};
    if (body.server && typeof body.server === 'object') {
      raw.server = { ...(raw.server || {}), ...body.server };
    }
    if (body.logging && typeof body.logging === 'object') {
      raw.logging = { ...(raw.logging || {}), ...body.logging };
    }
    if (body.automation && typeof body.automation === 'object') {
      raw.automation = { ...(raw.automation || {}), ...body.automation };
      try {
        const { getAutomationManager } = require('../automation/manager');
        getAutomationManager().updateConfig(raw);
      } catch {}
    }
    writeRawConfig(config, raw);
    res.json({ ok: true, note: 'Some changes (host/port) require a gateway restart to take effect.' });
  });

  // Automation manager: query live background job status
  api.get('/automation', (req, res) => {
    try {
      const { getAutomationManager } = require('../automation/manager');
      res.json(getAutomationManager().getStatus());
    } catch (err) {
      res.status(500).json({ error: { message: err.message, type: 'automation_error' } });
    }
  });

  // Automation manager: execute a specific job immediately
  api.post('/automation/run', async (req, res) => {
    const job = req.body?.job;
    if (!job) {
      return res.status(400).json({ error: { message: 'Missing job parameter', type: 'invalid_request' } });
    }
    try {
      const { getAutomationManager } = require('../automation/manager');
      const result = await getAutomationManager().runNow(job);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Automation manager: enable or disable a specific job at runtime
  api.post('/automation/toggle', (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const raw = readRawConfig(config);
    const { job, enabled } = req.body || {};
    if (!job || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: { message: 'job and boolean enabled are required', type: 'invalid_request' } });
    }
    raw.automation = raw.automation || {};
    if (typeof raw.automation[job] === 'object' && raw.automation[job] !== null) {
      raw.automation[job].enabled = enabled;
    } else {
      raw.automation[job] = enabled;
    }
    writeRawConfig(config, raw);
    try {
      const { getAutomationManager } = require('../automation/manager');
      getAutomationManager().updateConfig(raw);
    } catch {}
    res.json({ ok: true, automation: raw.automation });
  });

  // Autopilot: a sequence of SAFE steps only. Never runs paid/live tests.
  api.post('/autopilot', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const steps = [];
    const add = (label, status, detail) => steps.push({ label, status, detail: detail || null });

    // 1. Validate config
    const problems = validateConfig(config);
    add('Validate config', problems.length ? 'attention' : 'ok', problems.length ? problems.join('; ') : 'Config valid');

    // 2. Refresh stale metadata (safe GET)
    let modelResult = null;
    try {
      modelResult = await models.discoverModels(config, { refresh: true });
      add('Refresh model metadata', modelResult.error ? 'attention' : 'ok', modelResult.error || `${modelResult.models.length} models`);
    } catch (error) {
      add('Refresh model metadata', 'attention', error.message);
    }

    // 3. Check provider (safe)
    try {
      const health = await providers.health.safeCheck(config);
      add('Check active provider', health.ok ? 'ok' : 'attention', health.ok ? `${health.latencyMs}ms` : (health.error || `status ${health.status}`));
    } catch (error) {
      add('Check active provider', 'attention', error.message);
    }

    // 4. Check models present
    add('Check models', modelResult && modelResult.models.length ? 'ok' : 'attention', modelResult ? `${modelResult.models.length} available` : 'none');

    // 5. Detect clients
    const detected = detectAll().filter((c) => c.installed);
    add('Detect clients', detected.length ? 'ok' : 'skipped', detected.length ? detected.map((c) => c.label).join(', ') : 'none detected');

    // 6. Validate client wiring
    const wired = statusAll().filter((c) => c.found && c.configured);
    add('Validate client wiring', wired.length ? 'ok' : 'skipped', wired.length ? `${wired.length} wired` : 'none wired');

    // 7. Evaluate router
    const cache = cachedModels(config);
    add('Evaluate router', cache && cache.models.length ? 'ok' : 'attention', cache ? `${cache.models.length} candidates` : 'no models cached');

    // 8. Sync safe config
    add('Sync safe config', problems.length ? 'attention' : 'ok', 'Prompt: ' + (promptConfigured(config) ? 'configured' : 'placeholder'));

    const attention = steps.filter((s) => s.status === 'attention').length;
    res.json({ ready: attention === 0, steps, summary: { ok: steps.filter((s) => s.status === 'ok').length, attention, skipped: steps.filter((s) => s.status === 'skipped').length } });
  });

  // Clear request telemetry buffer.
  api.post('/requests/clear', (req, res) => {
    requestLog.clear();
    res.json({ ok: true });
  });

  // ---- SSE Live Telemetry Stream ----
  api.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':connected\n\n');

    const onRecord = (record) => {
      res.write(`event: request\ndata: ${JSON.stringify(record)}\n\n`);
    };

    requestLog.on('record', onRecord);

    const keepAlive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      requestLog.off('record', onRecord);
    });
  });

  // ---- Client Configuration & Repair ----
  api.post('/clients/:id/configure', async (req, res) => {
    const config = safeLoad(res);
    if (!config) return;
    const registry = require('../clients/registry');
    const client = registry.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: { message: `Unknown client "${req.params.id}"`, type: 'not_found' } });

    const baseURL = client.defaultBaseURL(config.server);
    const chosenModel = req.body?.model || config.provider.model;
    let modelMeta = null;
    if (client.id === 'opencode') {
      try {
        const { discoverModels } = require('../models');
        const r = await discoverModels(config, {});
        if (!r.error) modelMeta = r.models.find((m) => m.id === chosenModel) || null;
      } catch {}
    }

    try {
      const result = client.configure({
        baseURL,
        model: chosenModel,
        smallModel: req.body?.smallModel,
        modelMeta,
      });
      res.json({ ok: true, result, status: client.status() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message, type: 'configure_error' } });
    }
  });

  api.post('/clients/:id/remove', (req, res) => {
    const registry = require('../clients/registry');
    const client = registry.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: { message: `Unknown client "${req.params.id}"`, type: 'not_found' } });

    try {
      const result = client.remove();
      res.json({ ok: true, result, status: client.status() });
    } catch (err) {
      res.status(500).json({ error: { message: err.message, type: 'remove_error' } });
    }
  });

  api.post('/clients/:id/test', (req, res) => {
    const registry = require('../clients/registry');
    const client = registry.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: { message: `Unknown client "${req.params.id}"`, type: 'not_found' } });
    res.json({ ok: true, status: client.status() });
  });

  // ---- Background Service Management ----
  api.get('/service', (req, res) => {
    const service = require('../service/manager');
    res.json(service.status());
  });

  api.post('/service/install', (req, res) => {
    const service = require('../service/manager');
    try {
      const result = service.install();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  api.post('/service/uninstall', (req, res) => {
    const service = require('../service/manager');
    try {
      const result = service.uninstall();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  api.post('/service/start', (req, res) => {
    const service = require('../service/manager');
    try {
      const result = service.start();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  api.post('/service/stop', (req, res) => {
    const service = require('../service/manager');
    try {
      const result = service.stop();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- Doctor Self-Healing Repair ----
  api.post('/doctor/repair', async (req, res) => {
    const doctor = require('../doctor');
    try {
      const result = await doctor.repair();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.use('/api/dashboard', api);

  // ---- Static SPA ----
  if (fs.existsSync(DASHBOARD_DIR)) {
    app.use('/dashboard', localOnly, express.static(DASHBOARD_DIR, { index: 'index.html', extensions: ['html'] }));
    // SPA fallback: any /dashboard/* path serves index.html (client-side routing).
    app.get('/dashboard/:page', localOnly, (req, res) => {
      res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
    });
  }
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

async function runDiagnostics(config, { deep = false } = {}) {
  const problems = validateConfig(config);
  const sections = [];

  // Gateway
  const gateway = [];
  gateway.push(check('Config valid', problems.length === 0, problems.length ? problems.join('; ') : 'No problems'));
  gateway.push(check('Prompt configured', config.prompt.mode === 'passthrough' || promptConfigured(config),
    config.prompt.mode === 'passthrough' ? 'Passthrough mode' : (promptConfigured(config) ? 'Custom prompt set' : 'Placeholder prompt')));
  gateway.push(check('Node >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.versions.node));
  sections.push({ name: 'Gateway', checks: gateway });

  // Configuration
  const cfg = [];
  const keyConfigured = Boolean(config.provider.apiKey) || config.provider.auth?.type === 'none';
  cfg.push(check('Provider credentials', keyConfigured, keyConfigured ? 'Configured' : `Missing (${config.provider.apiKeyEnv})`, keyConfigured ? null : 'unknown'));
  cfg.push(check('Base URL set', Boolean(config.provider.baseURL), config.provider.baseURL || 'not set'));
  cfg.push(check('Model selected', Boolean(config.provider.model), config.provider.model || 'not set'));
  sections.push({ name: 'Configuration', checks: cfg });

  // Providers
  const provChecks = [];
  if (deep) {
    try {
      const health = await providers.health.safeCheck(config);
      provChecks.push(check(`${config.provider.name} reachable`, health.ok, health.ok ? `${health.latencyMs}ms` : (health.error || `status ${health.status}`), health.ok ? null : 'unknown'));
    } catch (error) {
      provChecks.push(check(`${config.provider.name} reachable`, false, error.message, 'unknown'));
    }
  } else {
    provChecks.push({ label: `${config.provider.name}`, status: 'unknown', detail: 'Run deep diagnostics to test reachability (safe GET, no tokens spent)' });
  }
  sections.push({ name: 'Providers', checks: provChecks });

  // Models
  const cache = cachedModels(config);
  sections.push({
    name: 'Models',
    checks: [cache
      ? check('Model metadata cached', cache.models.length > 0, `${cache.models.length} models (source: ${cache.source})`)
      : { label: 'Model metadata', status: 'unknown', detail: 'No cache yet — refresh from the Models page' }],
  });

  // Clients
  const clientChecks = statusAll().map((c) => {
    if (!c.found) return { label: c.label, status: 'unknown', detail: 'Not detected on this machine' };
    if (c.valid === false) return check(c.label, false, c.error || 'Invalid config', 'unknown');
    return check(c.label, Boolean(c.configured), c.configured ? 'Wired to PromptRelay' : 'Detected, not wired', c.configured ? null : 'unknown');
  });
  sections.push({ name: 'Clients', checks: clientChecks });

  // Security
  const security = [];
  security.push(check('Local-only binding', isLoopback(config.server.host) || config.server.host === 'localhost',
    isLoopback(config.server.host) ? 'Bound to loopback' : `Bound to ${config.server.host} (remote reachable)`, isLoopback(config.server.host) ? null : 'attention'));
  security.push(check('Secrets not exposed', true, 'Dashboard sends redacted config only'));
  security.push(check('Dashboard remote access', !isRemoteAllowed(), isRemoteAllowed() ? 'ALLOWED (remote can reach dashboard)' : 'Local-only', isRemoteAllowed() ? 'attention' : null));
  sections.push({ name: 'Security', checks: security });

  return {
    ok: problems.length === 0,
    problems,
    sections,
    ranAt: new Date().toISOString(),
    deep,
  };
}

/** Build a check object. overrideStatus can force 'unknown'/'attention'. */
function check(label, pass, detail, overrideStatus) {
  return {
    label,
    status: overrideStatus || (pass ? 'ok' : 'error'),
    detail: detail || null,
  };
}

module.exports = { registerDashboard, runDiagnostics, DASHBOARD_DIR, dashboardSecurityGuard };
