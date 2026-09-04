const express = require('express');
const { loadConfig, validateConfig, safeConfig } = require('./config');
const { ensurePromptFile, loadPrompt, promptConfigured } = require('./prompt');
const openAIAdapter = require('./adapters/openai-compatible');
const ollamaAdapter = require('./adapters/ollama-native');

const initialConfig = loadConfig();
ensurePromptFile(initialConfig);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100mb' }));

function adapterFor(config) {
  if (config.provider.transport === 'ollama-native') return ollamaAdapter;
  return openAIAdapter;
}

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
    version: '1.0.0',
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
    version: '1.0.0',
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
  return adapterFor(config).models(req, res, config);
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

  return adapterFor(config).chat(req, res, config);
});

app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Unsupported endpoint: ${req.method} ${req.path}`,
      type: 'not_found',
    },
  });
});

app.use((error, req, res, next) => {
  console.error('PromptRelay error:', error);
  if (res.headersSent) return next(error);
  return res.status(500).json({
    error: {
      message: error?.message || 'Internal PromptRelay error',
      type: 'promptrelay_error',
    },
  });
});

const host = initialConfig.server.host;
const port = initialConfig.server.port;

const server = app.listen(port, host, () => {
  const config = loadConfig();
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('⚡ PROMPTRELAY');
  console.log('══════════════════════════════════════════════');
  console.log(`Local       : http://${host}:${port}`);
  console.log(`Provider    : ${config.provider.name}`);
  console.log(`Transport   : ${config.provider.transport}`);
  console.log(`Base URL    : ${config.provider.baseURL}`);
  console.log(`Model       : ${config.provider.model}`);
  console.log(`Prompt mode : ${config.prompt.mode}`);
  console.log(`Prompt file : ${config.paths.promptFile}`);
  console.log(`Configured  : ${promptConfigured(config)}`);
  console.log('');
  console.log('PROMPT EDIT → HOT RELOAD');
  console.log('PROVIDER    → HOT RELOAD');
  console.log('STREAMING   → ENABLED');
  console.log('TOOLS       → ENABLED');
  console.log('REASONING   → ENABLED');
  console.log('══════════════════════════════════════════════');
  console.log('');
});

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down PromptRelay...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
