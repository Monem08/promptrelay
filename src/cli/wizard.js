'use strict';

/**
 * Interactive setup wizards for the PromptRelay CLI.
 *
 * These are the only pieces of the CLI that require a TTY. They orchestrate the
 * non-interactive command primitives (config load/save, discovery,
 * recommendation, OpenCode setup) into a friendly, JSON-free flow.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const io = require('./io');
const { ask, askRequired, yesNo, choose } = require('./prompts');
const { listPresets, getPreset } = require('../providers/presets');
const commands = require('./commands');

const STARTER_PROMPT = path.join(io.PACKAGE_ROOT, 'examples', 'system-prompt.txt');

function readConfig() {
  const bundled = io.readJsonIfExists(path.join(io.PACKAGE_ROOT, 'promptrelay.json'), {});
  const user = io.readJsonIfExists(io.CONFIG_FILE, null);
  return user || {
    server: { host: '127.0.0.1', port: 4141 },
    prompt: { mode: 'replace', file: 'system_prompt.txt', placeholder: io.PLACEHOLDER },
    provider: bundled.provider || {},
    reasoning: { default: 'low', injectDefault: false, auto: false },
    logging: { requests: true },
  };
}

// --- auth -------------------------------------------------------------------

async function configureAuth(rl, provider, defaultType = 'bearer') {
  const choices = [
    { label: 'Bearer token / API key', value: 'bearer' },
    { label: 'Custom header (for example x-api-key)', value: 'header' },
    { label: 'No authentication', value: 'none' },
  ];
  const defaultIndex = Math.max(0, choices.findIndex((c) => c.value === defaultType));
  const type = await choose(rl, 'Authentication', choices, defaultIndex);

  provider.auth = { type };
  provider.apiKeyEnv = provider.apiKeyEnv || 'PROVIDER_API_KEY';

  if (type === 'header') {
    provider.auth.headerName = await askRequired(rl, 'Header name', 'x-api-key');
  }
  if (type === 'none') return { needsKey: false };

  const key = await ask(rl, `API key (stored locally in ${io.ENV_FILE})`);
  if (key) io.writeEnvValue(provider.apiKeyEnv, key);
  return { needsKey: true, keyProvided: Boolean(key) };
}

// --- provider wizard --------------------------------------------------------

async function providerWizard(rl, current = readConfig()) {
  const presetList = listPresets();
  const providerType = await choose(
    rl,
    'Select your provider',
    presetList.map((p) => ({ label: p.label, value: p.id })),
    0,
  );

  const preset = getPreset(providerType);
  const provider = preset.provider;
  let reasoning = preset.reasoning;

  if (providerType === 'openrouter') {
    provider.model = await askRequired(rl, 'Model', current.provider?.model || 'openrouter/auto');
    const key = await ask(rl, `OpenRouter API key (stored locally in ${io.ENV_FILE})`);
    if (key) io.writeEnvValue(provider.apiKeyEnv, key);
  } else if (providerType === 'ollama-cloud') {
    provider.model = await askRequired(rl, 'Model (e.g. gpt-oss:120b)', current.provider?.model || '');
    const key = await ask(rl, `Ollama API key (stored locally in ${io.ENV_FILE})`);
    if (key) io.writeEnvValue(provider.apiKeyEnv, key);
  } else if (providerType === 'ollama-local') {
    provider.baseURL = await askRequired(rl, 'Base URL', provider.baseURL);
    provider.model = await askRequired(rl, 'Model', current.provider?.model || '');
  } else if (providerType === 'custom-openai') {
    provider.name = await askRequired(rl, 'Provider name', 'Custom Provider');
    provider.baseURL = await askRequired(rl, 'Base URL (include /v1 if your provider uses it)');
    provider.model = await askRequired(rl, 'Model ID');
    await configureAuth(rl, provider, 'bearer');
  } else {
    provider.name = await askRequired(rl, 'Provider name', 'Custom Ollama');
    provider.baseURL = await askRequired(rl, 'Base URL', provider.baseURL);
    provider.model = await askRequired(rl, 'Model ID');
    await configureAuth(rl, provider, 'none');
  }

  // Normalize the base URL (handles /v1 duplication etc.) without fabricating.
  try {
    const { normalizeProviderURL } = require('../providers/urls');
    provider.baseURL = normalizeProviderURL(provider.baseURL);
  } catch {}

  const forceModel = await yesNo(rl, 'Always use this configured model?', true);
  provider.forceModel = forceModel;

  return { provider, reasoning };
}

// --- prompt wizard ----------------------------------------------------------

async function promptWizard(rl, config) {
  const mode = await choose(
    rl,
    'Choose prompt mode',
    [
      { label: 'replace — use only your custom system prompt', value: 'replace' },
      { label: 'prepend — custom prompt + keep OpenCode instructions', value: 'prepend' },
      { label: 'append — keep OpenCode instructions + add custom prompt', value: 'append' },
      { label: 'passthrough — do not modify prompts', value: 'passthrough' },
    ],
    0,
  );

  config.prompt = { mode, file: 'system_prompt.txt', placeholder: io.PLACEHOLDER };
  if (mode === 'passthrough') return;

  const promptChoice = await choose(
    rl,
    'System instruction',
    [
      { label: 'Use the included starter coding-agent prompt', value: 'starter' },
      { label: 'Paste my own instruction now', value: 'paste' },
      { label: 'Create placeholder and edit later', value: 'later' },
    ],
    0,
  );

  if (promptChoice === 'starter' && fs.existsSync(STARTER_PROMPT)) {
    fs.copyFileSync(STARTER_PROMPT, io.PROMPT_FILE);
    return;
  }
  if (promptChoice === 'paste') {
    console.log('');
    console.log('Paste your instruction. Finish with a line containing only: .done');
    const lines = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = await rl.question('> ');
      if (line.trim() === '.done') break;
      lines.push(line);
    }
    const text = lines.join('\n').trim();
    fs.writeFileSync(io.PROMPT_FILE, `${text || io.PLACEHOLDER}\n`, 'utf8');
    return;
  }
  if (!fs.existsSync(io.PROMPT_FILE)) {
    fs.writeFileSync(io.PROMPT_FILE, `${io.PLACEHOLDER}\n`, 'utf8');
  }
}

// --- discovery + recommendation (best-effort, never fabricates) -------------

async function offerModelDiscovery(rl, config) {
  if (!(await yesNo(rl, 'Discover available models from this provider now?', true))) return;

  process.env.PROMPTRELAY_CONFIG = io.CONFIG_FILE;
  const { discoverModels, recommend, PROFILES } = require('../models');

  console.log('   Discovering models (this queries the provider /models endpoint)…');
  let result;
  try {
    result = await discoverModels(config, { refresh: true });
  } catch (error) {
    console.log(`   ⚠️ Discovery failed: ${error.message}`);
    return;
  }
  if (result.error) {
    console.log(`   ⚠️ Discovery failed: ${result.error}`);
    console.log('   You can keep the configured model and try `promptrelay models list` later.');
    return;
  }
  console.log(`   ✅ Found ${result.models.length} models (source: ${result.source}).`);

  if (!(await yesNo(rl, 'Get a transparent model recommendation?', true))) return;

  const profile = await choose(
    rl,
    'Optimize the recommendation for',
    PROFILES.map((p) => ({ label: p, value: p })),
    Math.max(0, PROFILES.indexOf('balanced')),
  );
  const rec = recommend(result.models, profile);
  console.log('');
  console.log(`   🎯 ${rec.explanation}`);
  if (!rec.model) return;
  if (await yesNo(rl, `Use "${rec.model.id}"?`, true)) {
    config.provider.model = rec.model.id;
    console.log(`   ✅ Model set to ${rec.model.id}`);
  }
}

// --- full setup -------------------------------------------------------------

async function setup() {
  io.ensureHome();
  commands.init({ quiet: true });

  const rl = readline.createInterface({ input, output });
  try {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('⚡ PromptRelay Setup');
    console.log('══════════════════════════════════════════════');
    console.log('No JSON editing required. Answer a few questions.');

    const config = readConfig();

    const { provider, reasoning } = await providerWizard(rl, config);
    config.provider = provider;
    config.reasoning = reasoning;
    config.server = config.server || { host: '127.0.0.1', port: 4141 };
    config.logging = config.logging || { requests: true };

    // Persist early so discovery can load a real config file.
    io.writeJson(io.CONFIG_FILE, config);

    await offerModelDiscovery(rl, config);
    await promptWizard(rl, config);
    io.writeJson(io.CONFIG_FILE, config);

    let openCodeResult = null;
    if (await yesNo(rl, 'Set up OpenCode integration automatically?', true)) {
      try {
        await commands.opencodeSetup();
        openCodeResult = true;
      } catch (error) {
        console.log(`   ⚠️ OpenCode setup failed: ${error.message}`);
      }
    }

    console.log('');
    console.log('✅ Setup complete');
    console.log(`   Provider : ${config.provider.name}`);
    console.log(`   Model    : ${config.provider.model}`);
    console.log(`   Mode     : ${config.prompt.mode}`);
    console.log(`   Config   : ${io.CONFIG_FILE}`);
    console.log(`   Prompt   : ${io.PROMPT_FILE}`);
    console.log('');
    console.log('Running diagnostics…');
    rl.close();
    await commands.doctor({});
    console.log('Start the gateway with:  promptrelay start');
    console.log('');
    return;
  } finally {
    // rl may already be closed above; guard against double close.
    try { rl.close(); } catch {}
  }
}

// --- provider-only setup ----------------------------------------------------

async function providerSetup() {
  io.ensureHome();
  commands.init({ quiet: true });
  const config = readConfig();
  const rl = readline.createInterface({ input, output });
  try {
    const { provider, reasoning } = await providerWizard(rl, config);
    config.provider = provider;
    config.reasoning = reasoning;
    io.writeJson(io.CONFIG_FILE, config);
    console.log('');
    console.log(`✅ Provider updated: ${provider.name} → ${provider.model}`);

    await offerModelDiscovery(rl, config);
    io.writeJson(io.CONFIG_FILE, config);
    console.log('Provider config is hot-reloaded — no restart needed if already running.');
    console.log('');
  } finally {
    try { rl.close(); } catch {}
  }
}

module.exports = { setup, providerSetup, providerWizard, promptWizard, configureAuth };
