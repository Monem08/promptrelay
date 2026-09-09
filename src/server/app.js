'use strict';

const express = require('express');
const { loadConfig, validateConfig, safeConfig, collectSecrets } = require('../config');
const { ensurePromptFile, loadPrompt, promptConfigured } = require('../prompts');
const { dispatchChat, dispatchModels } = require('../adapters');
const logger = require('../telemetry/logger');

const VERSION = require('../../package.json').version;

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
  app.use(express.json({ limit: '100mb' }));

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
    return res.status(500).json({
      error: {
        message: error?.message || 'Internal PromptRelay error',
        type: 'promptrelay_error',
      },
    });
  });

  return app;
}

module.exports = { createApp, VERSION };
