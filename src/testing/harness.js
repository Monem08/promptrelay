'use strict';

/**
 * Test harness: boots a real PromptRelay app (via the server app factory)
 * against a caller-supplied upstream base URL, using a throwaway config
 * directory. Returns the live gateway URL plus a cleanup function.
 *
 * Kept in src/testing (not test/) so the node test runner does not treat it as
 * a test file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PROMPT = 'You are a concise test assistant.';

/**
 * @param {object} opts
 * @param {string} opts.baseURL      upstream provider base URL (mock server)
 * @param {string} [opts.transport]  'openai-compatible' | 'ollama-native'
 * @param {object} [opts.provider]   extra provider fields (merged)
 * @param {object} [opts.config]     extra top-level config fields (merged)
 * @param {string} [opts.apiKey]     value for PROVIDER_API_KEY
 * @param {string} [opts.prompt]     system prompt contents
 * @returns {Promise<{ url: string, port: number, dir: string, close: () => Promise<void> }>}
 */
async function startGateway(opts = {}) {
  const {
    baseURL,
    transport = 'openai-compatible',
    provider = {},
    config = {},
    apiKey = 'sk-test-key-1234567890',
    prompt = DEFAULT_PROMPT,
  } = opts;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-gw-'));
  const configFile = path.join(dir, 'promptrelay.json');
  const promptFile = path.join(dir, 'system_prompt.txt');

  const providerBlock = {
    name: transport === 'ollama-native' ? 'Mock Ollama' : 'Mock OpenAI',
    transport,
    baseURL,
    model: transport === 'ollama-native' ? 'llama3' : 'mock-model',
    forceModel: true,
    apiKeyEnv: 'PROVIDER_API_KEY',
    auth: { type: 'bearer' },
    headers: {},
    ...(transport === 'ollama-native' ? { chatPath: '/api/chat', modelsPath: '/v1/models' } : {}),
    ...provider,
  };

  const fullConfig = {
    version: 2,
    // A valid port is required by validateConfig; the harness binds on an
    // ephemeral port via http.createServer below, so this value is unused.
    server: { host: '127.0.0.1', port: 4141 },
    prompt: { mode: 'replace', file: 'system_prompt.txt', placeholder: '{Paste your instructions here}' },
    provider: providerBlock,
    reasoning: { default: 'low', injectDefault: false, auto: false },
    logging: { requests: false },
    ...config,
  };

  fs.writeFileSync(configFile, `${JSON.stringify(fullConfig, null, 2)}\n`, 'utf8');
  fs.writeFileSync(promptFile, `${prompt}\n`, 'utf8');

  const prevConfig = process.env.PROMPTRELAY_CONFIG;
  const prevKey = process.env.PROVIDER_API_KEY;
  process.env.PROMPTRELAY_CONFIG = configFile;
  if (apiKey) process.env.PROVIDER_API_KEY = apiKey;

  // Require after env is set. createApp reads config per-request.
  const { createApp } = require('../server/app');
  const app = createApp();

  const http = require('http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    dir,
    close: () => new Promise((resolve) => {
      server.close(() => {
        if (prevConfig === undefined) delete process.env.PROMPTRELAY_CONFIG;
        else process.env.PROMPTRELAY_CONFIG = prevConfig;
        if (prevKey === undefined) delete process.env.PROVIDER_API_KEY;
        else process.env.PROVIDER_API_KEY = prevKey;
        resolve();
      });
    }),
  };
}

module.exports = { startGateway, DEFAULT_PROMPT };
