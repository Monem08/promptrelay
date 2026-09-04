#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { spawn, spawnSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const HOME = path.resolve(
  process.env.PROMPTRELAY_HOME || path.join(os.homedir(), '.promptrelay'),
);
const CONFIG_FILE = path.join(HOME, 'promptrelay.json');
const PROMPT_FILE = path.join(HOME, 'system_prompt.txt');
const ENV_FILE = path.join(HOME, '.env');
const OPENCODE_FILE = path.join(HOME, 'opencode.jsonc.example');
const OPENCODE_HOME = path.join(os.homedir(), '.config', 'opencode');
const OPENCODE_TARGET = path.join(OPENCODE_HOME, 'opencode.jsonc');

const PLACEHOLDER = '{Paste your instructions here}';
const STARTER_PROMPT = path.join(PACKAGE_ROOT, 'examples', 'system-prompt.txt');

function copyIfMissing(source, target) {
  if (fs.existsSync(target)) return false;
  fs.copyFileSync(source, target);
  return true;
}

function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
  try {
    fs.chmodSync(HOME, 0o700);
  } catch {}
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonIfExists(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeEnvValue(key, value) {
  ensureHome();
  const current = fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    : [];

  const lines = current.filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith(`${key}=`);
  });

  lines.push(`${key}=${JSON.stringify(String(value || ''))}`);
  fs.writeFileSync(ENV_FILE, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');

  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {}
}

function baseConfig() {
  const bundled = readJsonIfExists(path.join(PACKAGE_ROOT, 'promptrelay.json'), {});
  return {
    ...bundled,
    prompt: {
      mode: 'replace',
      file: 'system_prompt.txt',
      placeholder: PLACEHOLDER,
      ...(bundled.prompt || {}),
    },
    provider: {
      ...(bundled.provider || {}),
    },
    reasoning: {
      default: 'low',
      injectDefault: false,
      ...(bundled.reasoning || {}),
    },
  };
}

function init({ quiet = false } = {}) {
  ensureHome();

  const created = [];

  if (copyIfMissing(path.join(PACKAGE_ROOT, 'promptrelay.json'), CONFIG_FILE)) {
    created.push(CONFIG_FILE);
  }

  if (!fs.existsSync(PROMPT_FILE)) {
    fs.writeFileSync(PROMPT_FILE, `${PLACEHOLDER}\n`, 'utf8');
    created.push(PROMPT_FILE);
  }

  if (copyIfMissing(path.join(PACKAGE_ROOT, 'opencode.jsonc.example'), OPENCODE_FILE)) {
    created.push(OPENCODE_FILE);
  }

  if (quiet) return created;

  console.log('');
  console.log('⚡ PromptRelay initialized');
  console.log(`   Home   : ${HOME}`);
  console.log(`   Config : ${CONFIG_FILE}`);
  console.log(`   Prompt : ${PROMPT_FILE}`);
  console.log('');

  if (created.length) {
    console.log(`Created ${created.length} file${created.length === 1 ? '' : 's'}.`);
  } else {
    console.log('Existing configuration kept unchanged.');
  }

  console.log('');
  console.log('For the easiest setup, run:');
  console.log('  promptrelay setup');
  console.log('');
}

async function ask(rl, label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function yesNo(rl, label, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function choose(rl, title, options, defaultIndex = 0) {
  console.log('');
  console.log(title);
  options.forEach((option, index) => {
    const marker = index === defaultIndex ? ' ← default' : '';
    console.log(`  ${index + 1}. ${option.label}${marker}`);
  });

  while (true) {
    const raw = await ask(rl, 'Choose', String(defaultIndex + 1));
    const index = Number(raw) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      return options[index].value;
    }
    console.log(`Please enter 1-${options.length}.`);
  }
}

async function askRequired(rl, label, defaultValue = '') {
  while (true) {
    const value = await ask(rl, label, defaultValue);
    if (value) return value;
    console.log('This value is required.');
  }
}

async function configureAuth(rl, provider, defaultType = 'bearer') {
  const choices = [
    { label: 'Bearer token / API key', value: 'bearer' },
    { label: 'Custom header (for example x-api-key)', value: 'header' },
    { label: 'No authentication', value: 'none' },
  ];

  const defaultIndex = Math.max(0, choices.findIndex((item) => item.value === defaultType));
  const type = await choose(rl, 'Authentication', choices, defaultIndex);

  provider.auth = { type };
  provider.apiKeyEnv = 'PROVIDER_API_KEY';

  if (type === 'header') {
    provider.auth.headerName = await askRequired(rl, 'Header name', 'x-api-key');
  }

  if (type === 'none') {
    return { needsKey: false };
  }

  const key = await ask(rl, 'API key (stored locally in ~/.promptrelay/.env)');
  if (key) writeEnvValue(provider.apiKeyEnv, key);
  return { needsKey: true, keyProvided: Boolean(key) };
}

async function providerWizard(rl, current = baseConfig()) {
  const providerType = await choose(
    rl,
    'Select your provider',
    [
      { label: 'OpenRouter — easiest / recommended', value: 'openrouter' },
      { label: 'Ollama Cloud — native fast mode', value: 'ollama-cloud' },
      { label: 'Ollama Local — no API key', value: 'ollama-local' },
      { label: 'Custom OpenAI-compatible provider', value: 'custom-openai' },
      { label: 'Custom Ollama-native provider', value: 'custom-ollama' },
    ],
    0,
  );

  let provider;
  let reasoning = { default: 'low', injectDefault: false };

  if (providerType === 'openrouter') {
    provider = {
      name: 'OpenRouter',
      transport: 'openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      model: await askRequired(rl, 'Model', current.provider?.model || 'openrouter/auto'),
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      headers: {
        'HTTP-Referer': 'https://github.com/Monem08/promptrelay',
        'X-Title': 'PromptRelay',
      },
    };

    const key = await ask(rl, 'OpenRouter API key (stored locally in ~/.promptrelay/.env)');
    if (key) writeEnvValue('PROVIDER_API_KEY', key);
  } else if (providerType === 'ollama-cloud') {
    provider = {
      name: 'Ollama Cloud',
      transport: 'ollama-native',
      baseURL: 'https://ollama.com',
      model: await askRequired(rl, 'Model', 'glm-5.3-flash'),
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    };
    reasoning = { default: 'low', injectDefault: true };

    const key = await ask(rl, 'Ollama API key (stored locally in ~/.promptrelay/.env)');
    if (key) writeEnvValue('PROVIDER_API_KEY', key);
  } else if (providerType === 'ollama-local') {
    provider = {
      name: 'Ollama Local',
      transport: 'ollama-native',
      baseURL: await askRequired(rl, 'Base URL', 'http://127.0.0.1:11434'),
      model: await askRequired(rl, 'Model'),
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'none' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    };
    reasoning = { default: 'low', injectDefault: true };
  } else if (providerType === 'custom-openai') {
    provider = {
      name: await askRequired(rl, 'Provider name', 'Custom Provider'),
      transport: 'openai-compatible',
      baseURL: await askRequired(rl, 'Base URL (include /v1 if your provider uses it)'),
      model: await askRequired(rl, 'Model ID'),
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      headers: {},
    };
    await configureAuth(rl, provider, 'bearer');
  } else {
    provider = {
      name: await askRequired(rl, 'Provider name', 'Custom Ollama'),
      transport: 'ollama-native',
      baseURL: await askRequired(rl, 'Base URL', 'http://127.0.0.1:11434'),
      model: await askRequired(rl, 'Model ID'),
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'none' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    };
    reasoning = { default: 'low', injectDefault: true };
    await configureAuth(rl, provider, 'none');
  }

  const dynamicModel = await yesNo(rl, 'Always use this configured model?', true);
  provider.forceModel = dynamicModel;

  return { provider, reasoning };
}

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

  config.prompt = {
    mode,
    file: 'system_prompt.txt',
    placeholder: PLACEHOLDER,
  };

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

  if (promptChoice === 'starter') {
    fs.copyFileSync(STARTER_PROMPT, PROMPT_FILE);
    return;
  }

  if (promptChoice === 'paste') {
    console.log('');
    console.log('Paste your instruction. Finish with a line containing only: .done');
    const lines = [];
    while (true) {
      const line = await rl.question('> ');
      if (line.trim() === '.done') break;
      lines.push(line);
    }
    const text = lines.join('\n').trim();
    fs.writeFileSync(PROMPT_FILE, `${text || PLACEHOLDER}\n`, 'utf8');
    return;
  }

  if (!fs.existsSync(PROMPT_FILE)) {
    fs.writeFileSync(PROMPT_FILE, `${PLACEHOLDER}\n`, 'utf8');
  }
}

function installOpenCodeConfig() {
  ensureHome();
  copyIfMissing(path.join(PACKAGE_ROOT, 'opencode.jsonc.example'), OPENCODE_FILE);
  fs.mkdirSync(OPENCODE_HOME, { recursive: true });

  if (!fs.existsSync(OPENCODE_TARGET)) {
    fs.copyFileSync(OPENCODE_FILE, OPENCODE_TARGET);
    return {
      installed: true,
      path: OPENCODE_TARGET,
      message: 'OpenCode config installed.',
    };
  }

  const alternate = path.join(OPENCODE_HOME, 'opencode.promptrelay.jsonc');
  fs.copyFileSync(OPENCODE_FILE, alternate);
  return {
    installed: false,
    path: alternate,
    message: `Existing OpenCode config was kept safe. PromptRelay config example written to ${alternate}`,
  };
}

async function setup() {
  ensureHome();
  init({ quiet: true });

  const rl = readline.createInterface({ input, output });
  try {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('⚡ PromptRelay Setup');
    console.log('══════════════════════════════════════════════');
    console.log('No JSON editing required. Answer a few questions.');

    const config = fs.existsSync(CONFIG_FILE)
      ? readJsonIfExists(CONFIG_FILE, baseConfig())
      : baseConfig();

    const { provider, reasoning } = await providerWizard(rl, config);
    config.provider = provider;
    config.reasoning = reasoning;
    config.server = config.server || { host: '127.0.0.1', port: 4141 };
    config.logging = config.logging || { requests: true };

    await promptWizard(rl, config);
    writeJson(CONFIG_FILE, config);

    let openCodeResult = null;
    if (await yesNo(rl, 'Generate OpenCode config automatically?', true)) {
      openCodeResult = installOpenCodeConfig();
    }

    console.log('');
    console.log('✅ Setup complete');
    console.log(`   Provider : ${config.provider.name}`);
    console.log(`   Model    : ${config.provider.model}`);
    console.log(`   Mode     : ${config.prompt.mode}`);
    console.log(`   Config   : ${CONFIG_FILE}`);
    console.log(`   Prompt   : ${PROMPT_FILE}`);
    if (openCodeResult) console.log(`   OpenCode : ${openCodeResult.message}`);
    console.log('');
    console.log('Run:');
    console.log('  promptrelay doctor');
    console.log('  promptrelay');
    console.log('');
  } finally {
    rl.close();
  }
}

async function providerSetup() {
  ensureHome();
  init({ quiet: true });
  const config = readJsonIfExists(CONFIG_FILE, baseConfig());
  const rl = readline.createInterface({ input, output });

  try {
    const { provider, reasoning } = await providerWizard(rl, config);
    config.provider = provider;
    config.reasoning = reasoning;
    writeJson(CONFIG_FILE, config);
    console.log('');
    console.log(`✅ Provider updated: ${provider.name} → ${provider.model}`);
    console.log('No restart is needed if PromptRelay is already running; provider config is hot-reloaded.');
    console.log('');
  } finally {
    rl.close();
  }
}

function doctor() {
  ensureHome();
  process.env.PROMPTRELAY_CONFIG = process.env.PROMPTRELAY_CONFIG || CONFIG_FILE;

  const { loadConfig, validateConfig } = require('../src/config');
  const { promptConfigured } = require('../src/prompt');

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`❌ Config error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const problems = validateConfig(config);
  const keyConfigured = Boolean(config.provider.apiKey) || config.provider.auth?.type === 'none';
  const promptOk = config.prompt.mode === 'passthrough' || promptConfigured(config);

  console.log('');
  console.log('🩺 PromptRelay doctor');
  console.log(`   Provider    : ${config.provider.name}`);
  console.log(`   Transport   : ${config.provider.transport}`);
  console.log(`   Base URL    : ${config.provider.baseURL}`);
  console.log(`   Model       : ${config.provider.model}`);
  console.log(`   Prompt mode : ${config.prompt.mode}`);
  console.log(`   Prompt      : ${promptOk ? '✅ configured' : '❌ not configured'}`);
  console.log(`   API key     : ${keyConfigured ? '✅ configured' : `❌ missing (${config.provider.apiKeyEnv})`}`);
  console.log(`   Config      : ${config.paths.configFile}`);

  if (problems.length) {
    for (const problem of problems) console.log(`   Config      : ❌ ${problem}`);
  }

  const ok = !problems.length && promptOk && keyConfigured;
  console.log('');
  console.log(ok ? '✅ Ready to run.' : '⚠️ Run `promptrelay setup` to fix the setup interactively.');
  console.log('');
  process.exitCode = ok ? 0 : 1;
}

function openFile(file) {
  ensureHome();
  if (!fs.existsSync(file)) init({ quiet: true });

  const editor = process.env.EDITOR || process.env.VISUAL;
  let command;
  let args;

  if (editor) {
    command = editor;
    args = [file];
  } else if (process.platform === 'win32') {
    command = 'notepad.exe';
    args = [file];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = ['-e', file];
  } else {
    console.log(file);
    console.log('Set $EDITOR to open it automatically, for example: export EDITOR=nano');
    return;
  }

  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.log(file);
    console.error(`Could not open editor: ${result.error.message}`);
  }
}

async function start() {
  ensureHome();

  if (!fs.existsSync(CONFIG_FILE)) {
    if (input.isTTY && output.isTTY) {
      console.log('First run detected — launching easy setup.');
      await setup();
    } else {
      init();
      console.log('Run `promptrelay setup` in a terminal, then start PromptRelay again.');
      return;
    }
  }

  const env = {
    ...process.env,
    PROMPTRELAY_CONFIG: process.env.PROMPTRELAY_CONFIG || CONFIG_FILE,
  };

  const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'src', 'server.js')], {
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function printHelp() {
  console.log(`
⚡ PromptRelay CLI

Easy start:
  promptrelay setup        Interactive setup: provider + model + API key + prompt
  promptrelay              Start PromptRelay

Change things later:
  promptrelay provider     Interactive provider/model setup
  promptrelay prompt       Open your custom system prompt
  promptrelay config       Open PromptRelay config
  promptrelay opencode     Install/generate OpenCode config
  promptrelay doctor       Check everything

Other:
  promptrelay init         Create config files without changing existing ones
  promptrelay path         Print ~/.promptrelay path
  promptrelay --version    Print version
  promptrelay --help       Show this help

Install from GitHub:
  npm i -g github:Monem08/promptrelay

After npm publication:
  npm i -g @monem08/promptrelay
`);
}

async function main() {
  const command = String(process.argv[2] || 'start').toLowerCase();

  switch (command) {
    case 'start':
      await start();
      break;
    case 'setup':
      await setup();
      break;
    case 'provider':
      await providerSetup();
      break;
    case 'prompt':
      openFile(PROMPT_FILE);
      break;
    case 'config':
      openFile(CONFIG_FILE);
      break;
    case 'opencode': {
      const result = installOpenCodeConfig();
      console.log(result.message);
      console.log(result.path);
      break;
    }
    case 'init':
      init();
      break;
    case 'doctor':
      doctor();
      break;
    case 'path':
      console.log(HOME);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    case '--version':
    case '-v':
      console.log(require('../package.json').version);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`PromptRelay CLI error: ${error.message}`);
  process.exitCode = 1;
});
