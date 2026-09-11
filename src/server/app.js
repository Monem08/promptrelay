'use strict';

const crypto = require('crypto');
const express = require('express');
const { loadConfig, validateConfig, safeConfig, collectSecrets } = require('../config');
const { ensurePromptFile, loadPrompt, promptConfigured } = require('../prompts');
const { dispatchChat, dispatchModels } = require('../adapters');
const { handleMessages } = require('./messages');
const { registerDashboard } = require('./dashboard');
const requestLog = require('../telemetry/requests');
const logger = require('../telemetry/logger');
const routing = require('../routing/engine');

const VERSION = require('../../package.json').version;

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

function gatewayAuthMiddleware(req, res, next) {
  let config;
  try {
    config = loadConfig();
  } catch {
    return next();
  }

  const enabled = Boolean(
    config.security?.gatewayAuth?.enabled ||
    config.server?.apiKey ||
    process.env.PROMPTRELAY_GATEWAY_KEY
  );

  if (!enabled) {
    return next();
  }

  const expectedToken = String(
    process.env.PROMPTRELAY_GATEWAY_KEY ||
    config.security?.gatewayAuth?.token ||
    config.server?.apiKey ||
    ''
  ).trim();

  if (!expectedToken) {
    return res.status(500).json({
      error: {
        message: 'Gateway authentication is enabled but no token is configured.',
        type: 'gateway_auth_configuration_error',
      },
    });
  }

  let providedToken = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  } else if (req.headers['x-api-key']) {
    providedToken = String(req.headers['x-api-key']).trim();
  }

  if (!providedToken) {
    return res.status(401).json({
      error: {
        message: 'Missing API key. Provide Authorization: Bearer <key> or x-api-key header.',
        type: 'missing_api_key',
      },
    });
  }

  if (!timingSafeEqualStr(providedToken, expectedToken)) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key.',
        type: 'invalid_api_key',
      },
    });
  }

  return next();
}

/**
 * Create the PromptRelay Express app WITHOUT binding a port. This makes the app
 * importable and testable. Config is reloaded per request to preserve hot-reload.
 */
function createApp() {
  const initialConfig = loadConfig();
  ensurePromptFile(initialConfig);
  logger.setSecrets(collectSecrets(initialConfig));

  const app = express();
  app.disable('x-powered-by');

  // Configurable body limit — never use a massive default.
  const bodyLimit = initialConfig.server?.bodyLimitBytes || (2 * 1024 * 1024);
  app.use(express.json({ limit: bodyLimit }));

  function configOrError(res) {
    let config;
    try {
      config = loadConfig();
    } catch (error) {
      res.status(500).json({
        error: {
          message: `Failed to read PromptRelay config: ${error.message}`,
          type: 'promptrelay_config_error',
        },
      });
      return null;
    }
    // Refresh redaction secrets in case the key changed via hot-reload.
    logger.setSecrets(collectSecrets(config));

    const problems = validateConfig(config);
    if (problems.length) {
      res.status(500).json({
        error: {
          message: problems.join('; '),
          type: 'promptrelay_config_error',
        },
      });
      return null;
    }
    return config;
  }

  app.get('/', (_, res) => {
    const config = configOrError(res);
    if (!config) return;
    res.json({
      name: 'PromptRelay',
      version: VERSION,
      tagline: "Take control of your coding agent's system prompt.",
      provider: config.provider.name,
      transport: config.provider.transport,
      model: config.provider.model,
      promptMode: config.prompt.mode,
      endpoints: {
        health: '/health',
        models: '/v1/models',
        chat: '/v1/chat/completions',
        messages: '/v1/messages',
      },
    });
  });

  app.get('/health', (_, res) => {
    let config;
    try {
      config = loadConfig();
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        problems: [`Failed to read config: ${error.message}`],
      });
    }

    const problems = validateConfig(config);
    const prompt = loadPrompt(config);

    res.status(problems.length ? 500 : 200).json({
      status: problems.length ? 'error' : 'ok',
      version: VERSION,
      ...safeConfig(config),
      promptConfigured: promptConfigured(config),
      promptCharacters: prompt.length,
      hotReload: {
        prompt: true,
        provider: true,
        model: true,
        serverPort: false,
      },
      problems,
    });
  });

  // Gateway authentication for /v1/* endpoints (when enabled)
  app.use('/v1', gatewayAuthMiddleware);

  app.get('/v1/models', async (req, res) => {
    const config = configOrError(res);
    if (!config) return;
    return dispatchModels(req, res, config);
  });

  app.post('/v1/chat/completions', async (req, res) => {
    const config = configOrError(res);
    if (!config) return;

    if (!Array.isArray(req.body?.messages)) {
      return res.status(400).json({
        error: {
          message: 'messages must be an array',
          type: 'invalid_request_error',
        },
      });
    }

    if (config.prompt.mode !== 'passthrough' && !promptConfigured(config)) {
      return res.status(503).json({
        error: {
          message: `Custom instruction is not configured. Open ${config.paths.promptFile} and replace ${config.prompt.placeholder}`,
          type: 'promptrelay_prompt_not_configured',
        },
      });
    }

    return dispatchChat(req, res, config);
  });

  // Anthropic Messages ingress (e.g. Claude Code). Normalizes to IR then
  // dispatches to whichever provider PromptRelay is configured for.
  app.post('/v1/messages', async (req, res) => {
    const config = configOrError(res);
    if (!config) return;

    // Use routing engine for client detection and telemetry state
    const clientId = routing.detectClient(req);
    const { profile } = routing.resolveProfile(clientId, config);
    const state = routing.createRequestState(config, clientId, profile);

    // Record Anthropic-ingress request metadata (off the hot path, no content).
    const startedAt = Date.now();
    let recorded = false;
    const finalize = () => {
      if (recorded) return;
      recorded = true;
      // Respect logging mode: 'off' records nothing new.
      if (config.logging?.mode === 'off') return;
      try {
        requestLog.record({
          client: state.client,
          ingress: 'anthropic',
          provider: state.provider,
          model: state.model,
          profile: state.profile,
          fallback: state.fallback,
          retries: state.retries || 0,
          providerAttempts: state.providerAttempts,
          status: res.statusCode,
          stream: Boolean(req.body?.stream),
          totalMs: Date.now() - startedAt,
          ttftMs: state.ttftMs || 'unknown',
          tokens: state.tokens || 'unknown',
          reasoning: config.reasoning?.auto ? 'auto' : config.reasoning?.default,
          error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : (state.error || null),

        });
      } catch {}
    };
    res.on('finish', finalize);
    res.on('close', finalize);
    return handleMessages(req, res, config, state);
  });

  // Dashboard: read-only APIs + static SPA. Mounted BEFORE the 404 handler and
  // isolated from the proxy hot path above.
  registerDashboard(app);

  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: `Unsupported endpoint: ${req.method} ${req.path}`,
        type: 'not_found',
      },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error('PromptRelay error:', error?.message || error);
    if (res.headersSent) return next(error);
    const status = error.status || error.statusCode || 500;
    return res.status(status).json({
      error: {
        message: error?.message || 'Internal PromptRelay error',
        type: status === 413 ? 'payload_too_large' : 'promptrelay_error',
      },
    });
  });

  return app;
}

module.exports = { createApp, VERSION };
