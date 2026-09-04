#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const HOME = path.resolve(
  process.env.PROMPTRELAY_HOME || path.join(os.homedir(), '.promptrelay'),
);
const CONFIG_FILE = path.join(HOME, 'promptrelay.json');
const PROMPT_FILE = path.join(HOME, 'system_prompt.txt');
const OPENCODE_FILE = path.join(HOME, 'opencode.jsonc.example');

const PLACEHOLDER = '{Paste your instructions here}';

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

function init() {
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
  console.log('Next:');
  console.log(`  1. Edit ${PROMPT_FILE}`);
  console.log('  2. Set PROVIDER_API_KEY in your environment');
  console.log('  3. Run: promptrelay');
  console.log('');
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
  console.log(`   Config      : ${config.paths.configFile}`);
  console.log(`   Provider    : ${config.provider.name}`);
  console.log(`   Transport   : ${config.provider.transport}`);
  console.log(`   Model       : ${config.provider.model}`);
  console.log(`   Prompt mode : ${config.prompt.mode}`);
  console.log(`   Prompt      : ${promptOk ? '✅ configured' : '❌ not configured'}`);
  console.log(`   API key     : ${keyConfigured ? '✅ configured' : `❌ missing (${config.provider.apiKeyEnv})`}`);

  if (problems.length) {
    for (const problem of problems) console.log(`   Config      : ❌ ${problem}`);
  }

  const ok = !problems.length && promptOk && keyConfigured;
  console.log('');
  console.log(ok ? '✅ Ready to run.' : '⚠️ Fix the items above, then run promptrelay again.');
  console.log('');
  process.exitCode = ok ? 0 : 1;
}

function start() {
  ensureHome();

  if (!fs.existsSync(CONFIG_FILE)) {
    init();
    console.log('Run `promptrelay` again after adding your prompt and API key.');
    return;
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

Usage:
  promptrelay            Start PromptRelay
  promptrelay init       Create ~/.promptrelay config files
  promptrelay doctor     Check prompt/provider setup
  promptrelay path       Print PromptRelay home directory
  promptrelay help       Show this help

Install from GitHub today:
  npm i -g github:Monem08/promptrelay

After npm publication:
  npm i -g @monem08/promptrelay
`);
}

const command = String(process.argv[2] || 'start').toLowerCase();

switch (command) {
  case 'start':
    start();
    break;
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
