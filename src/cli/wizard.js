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

// --- dry-run setup ----------------------------------------------------------

async function setupDryRun() {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('🔍 PromptRelay Setup · DRY RUN');
  console.log('══════════════════════════════════════════════');
  console.log('Inspecting system environment. Zero filesystem mutations will occur.\n');

  // 1. Provider detection
  const credentials = require('../providers/credentials');
  const detectedCreds = credentials.detectedCredentials();
  console.log('[1/4] Provider Detection:');
  if (detectedCreds.length > 0) {
    for (const d of detectedCreds) {
      console.log(`  - Environment credential detected: ${d.label} via $${d.envVar} (never printed)`);
    }
  } else {
    console.log('  - No provider credentials found in environment variables.');
  }

  let ollamaFound = false;
  try {
    const { fetchWithTimeout } = require('../providers/detect');
    const res = await fetchWithTimeout('http://127.0.0.1:11434/api/tags', { method: 'GET' }, 1500);
    if (res.ok) {
      ollamaFound = true;
      console.log('  - Local Ollama instance detected at http://127.0.0.1:11434');
    }
  } catch {}

  // 2. Client detection
  const registry = require('../clients/registry');
  const detectedClients = registry.detectAll();
  console.log('\n[2/4] Client Detection:');
  for (const c of detectedClients) {
    console.log(`  - ${c.label.padEnd(14)}: installed=${c.installed ? 'yes' : 'no'}, config=${c.configState || 'unknown'}, path=${c.configPath || c.path}`);
    if (c.executable) {
      console.log(`    executable : ${c.executable}${c.version ? ` (v${c.version})` : ''}`);
    }
  }

  // 3. Model discovery
  console.log('\n[3/4] Model Discovery:');
  const mockConfig = readConfig();
  if (detectedCreds.length > 0 || ollamaFound) {
    console.log('  - Provider endpoints reachable for model discovery: yes');
  } else {
    console.log('  - Model discovery would query provider /models endpoint on live setup');
  }

  // 4. Proposed configuration validation
  console.log('\n[4/4] Configuration Validation:');
  const { validateConfig } = require('../config/validate');
  const problems = validateConfig(mockConfig);
  if (problems.length) {
    console.log(`  ❌ Proposed configuration has problems: ${problems.join('; ')}`);
  } else {
    console.log('  ✅ Proposed gateway configuration is valid.');
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('Dry run complete. Zero filesystem mutations performed.');
  console.log('Run `promptrelay setup` or `promptrelay setup --auto` to apply.');
  console.log('══════════════════════════════════════════════\n');

  return { dryRun: true, clients: detectedClients, credentials: detectedCreds, valid: problems.length === 0 };
}

// --- automatic setup --------------------------------------------------------

async function setupAuto(options = {}) {
  const { noStart = false, installService = false } = options;
  io.ensureHome();
  commands.init({ quiet: true });

  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('⚡ PromptRelay Setup · AUTOMATIC');
  console.log('══════════════════════════════════════════════');

  const config = readConfig();

  // 1. Genuine Provider detection
  const credentials = require('../providers/credentials');
  const detectedCreds = credentials.detectedCredentials();
  const { getPreset } = require('../providers/presets');

  if (detectedCreds.find((c) => c.envVar === 'OPENROUTER_API_KEY')) {
    const preset = getPreset('openrouter');
    config.provider = { ...preset.provider, model: config.provider?.model || 'openrouter/auto', forceModel: true };
    config.reasoning = preset.reasoning;
    console.log('  ✅ Detected OpenRouter credentials in environment ($OPENROUTER_API_KEY)');
  } else if (detectedCreds.find((c) => c.envVar === 'ANTHROPIC_API_KEY')) {
    config.provider = {
      name: 'Anthropic',
      transport: 'anthropic-native',
      baseURL: 'https://api.anthropic.com',
      model: config.provider?.model || 'claude-3-7-sonnet-20250219',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      auth: { type: 'header', headerName: 'x-api-key' },
      forceModel: false,
    };
    console.log('  ✅ Detected Anthropic credentials in environment ($ANTHROPIC_API_KEY)');
  } else if (detectedCreds.find((c) => c.envVar === 'OPENAI_API_KEY')) {
    const preset = getPreset('custom-openai');
    config.provider = { ...preset.provider, model: config.provider?.model || 'gpt-4o', apiKeyEnv: 'OPENAI_API_KEY', forceModel: false };
    console.log('  ✅ Detected OpenAI credentials in environment ($OPENAI_API_KEY)');
  } else {
    // Probe local Ollama
    let ollamaFound = false;
    try {
      const { fetchWithTimeout } = require('../providers/detect');
      const res = await fetchWithTimeout('http://127.0.0.1:11434/api/tags', { method: 'GET' }, 1500);
      if (res.ok) {
        ollamaFound = true;
        const preset = getPreset('ollama-local');
        config.provider = { ...preset.provider, model: config.provider?.model || 'qwen2.5-coder:7b', forceModel: false };
        config.reasoning = preset.reasoning;
        console.log('  ✅ Detected running Ollama instance at http://127.0.0.1:11434');
      }
    } catch {}

    if (!ollamaFound && (!config.provider || !config.provider.name)) {
      const preset = getPreset('openrouter');
      config.provider = { ...preset.provider, model: 'openrouter/auto', forceModel: true };
      config.reasoning = preset.reasoning;
      console.log('  ℹ️ Configured default OpenRouter profile ($OPENROUTER_API_KEY can be added to ~/.promptrelay/.env)');
    }
  }

  // 2. Discover models if possible (best-effort)
  try {
    const { discoverModels } = require('../models');
    process.env.PROMPTRELAY_CONFIG = io.CONFIG_FILE;
    const disc = await discoverModels(config, { refresh: false });
    if (!disc.error && disc.models?.length) {
      console.log(`  ✅ Discovered ${disc.models.length} models from provider.`);
    }
  } catch {}

  // 3. Validate and safe write configuration
  const { validateConfig } = require('../config/validate');
  const problems = validateConfig(config);
  if (problems.length) {
    console.error(`  ❌ Configuration validation failed: ${problems.join('; ')}`);
  } else {
    io.writeJson(io.CONFIG_FILE, config);
    console.log(`  ✅ Gateway configuration written atomically to ${io.CONFIG_FILE}`);
  }

  // 4. Client detection & configuration (ALL detected clients in ONE setup run)
  const registry = require('../clients/registry');
  const detectedClients = registry.detectAll().filter((c) => c.installed || c.found);
  console.log(`\n  Configuring detected coding clients (${detectedClients.length}):`);
  if (detectedClients.length > 0) {
    for (const dc of detectedClients) {
      try {
        await commands.clientSetup(dc.id);
      } catch (err) {
        console.log(`    ⚠️ Could not configure ${dc.label}: ${err.message}`);
      }
    }
  } else {
    try {
      await commands.opencodeSetup();
    } catch {}
  }

  // 5. Optional service installation
  if (installService) {
    try {
      const service = require('../service/manager');
      service.install({ envFile: io.ENV_FILE });
      console.log('  ✅ Background service installed.');
    } catch (err) {
      console.log(`  ⚠️ Service install skipped: ${err.message}`);
    }
  }

  console.log('\n✅ Automatic setup complete.');
  console.log(`   Provider : ${config.provider?.name}`);
  console.log(`   Model    : ${config.provider?.model}`);
  console.log(`   Config   : ${io.CONFIG_FILE}`);
  if (noStart) {
    console.log('   Service start skipped (--no-start).');
  } else {
    console.log('   Ready to run. Start with: promptrelay start');
  }
  console.log('');

  return { success: true, config, clients: detectedClients };
}

// --- full setup -------------------------------------------------------------

async function setup(flags = {}) {
  const isDryRun = Boolean(flags['dry-run'] || flags.dryRun);
  const isAuto = Boolean(flags.auto || !input.isTTY);
  const noStart = Boolean(flags['no-start'] || flags.noStart);
  const installService = Boolean(flags.service);

  if (isDryRun) {
    return setupDryRun();
  }

  if (isAuto) {
    return setupAuto({ noStart, installService });
  }

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

    const registry = require('../clients/registry');
    const detectedClients = registry.detectAll().filter((c) => c.installed);

    if (detectedClients.length > 0) {
      console.log('\nDetected coding clients:');
      for (const dc of detectedClients) {
        console.log(`  - ${dc.label} (${dc.path})`);
      }
      if (await yesNo(rl, 'Configure all detected clients automatically to use PromptRelay?', true)) {
        for (const dc of detectedClients) {
          try {
            await commands.clientSetup(dc.id);
          } catch (error) {
            console.log(`   ⚠️ Setup failed for ${dc.label}: ${error.message}`);
          }
        }
      }
    } else {
      if (await yesNo(rl, 'Set up OpenCode integration automatically?', true)) {
        try {
          await commands.opencodeSetup();
        } catch (error) {
          console.log(`   ⚠️ OpenCode setup failed: ${error.message}`);
        }
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
    if (installService) {
      try {
        const service = require('../service/manager');
        service.install({ envFile: io.ENV_FILE });
        console.log('Background service installed.');
      } catch {}
    }
    if (!noStart) {
      console.log('Start the gateway with:  promptrelay start');
    }
    console.log('');
    return;
  } finally {
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

module.exports = {
  setup,
  setupDryRun,
  setupAuto,
  providerSetup,
  providerWizard,
  promptWizard,
  configureAuth,
};
