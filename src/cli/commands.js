'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const io = require('./io');
const { maskSecret } = require('../telemetry/secrets');

/** Load the user config with PROMPTRELAY_CONFIG pinned to the user file. */
function loadUserConfig() {
  process.env.PROMPTRELAY_CONFIG = process.env.PROMPTRELAY_CONFIG || io.CONFIG_FILE;
  // Require lazily so env is set first.
  const { loadConfig } = require('../config');
  return loadConfig();
}

function readRawConfig() {
  return io.readJsonIfExists(io.CONFIG_FILE, {});
}

function saveRawConfig(config) {
  io.ensureHome();
  io.writeJson(io.CONFIG_FILE, config);
}

// --- version / help ---------------------------------------------------------

function version() {
  console.log(require('../../package.json').version);
}

function printHelp() {
  console.log(`
⚡ PromptRelay CLI

Quick start:
  promptrelay setup                Interactive setup (provider → key → discovery → model → prompt → OpenCode)
  promptrelay start                Start the gateway
  promptrelay doctor               Diagnose your configuration

Lifecycle:
  promptrelay start [--daemon]     Start (foreground, or background with --daemon)
  promptrelay stop                 Stop a running gateway
  promptrelay restart              Restart the gateway
  promptrelay status               Show running status + live /health

Providers:
  promptrelay provider             Interactive provider/model wizard
  promptrelay provider list        List configured provider profiles
  promptrelay provider add         Add a provider profile (interactive)
  promptrelay provider use <name>  Switch the active provider profile
  promptrelay provider test [--live]  Health-check the active provider
  promptrelay provider remove <name>  Remove a provider profile

Models:
  promptrelay models list [--json] Discover & list provider models
  promptrelay models free          List verified free models
  promptrelay models refresh       Refresh the model cache
  promptrelay models recommend [--profile <p>]  Recommend a model
  promptrelay model use <id>       Set the active model

Auto & reasoning:
  promptrelay auto [--profile <p>] Auto-select the best model for a profile
  promptrelay reasoning list       List reasoning levels
  promptrelay reasoning set <lvl>  Set default reasoning (none…max, or auto)

Prompt & config:
  promptrelay prompt               Open your custom system prompt
  promptrelay prompt use <file>    Load a prompt from a file
  promptrelay config               Open the config file
  promptrelay config validate      Validate the config

OpenCode:
  promptrelay opencode             Set up OpenCode integration
  promptrelay opencode status      Show OpenCode integration status
  promptrelay opencode repair      Re-merge the PromptRelay provider

Keys:
  promptrelay keys set <ENV> <val> Store a secret in ~/.promptrelay/.env
  promptrelay keys list            List stored key names (masked)
  promptrelay keys remove <ENV>    Remove a stored secret

Other:
  promptrelay init                 Create config files without overwriting
  promptrelay dashboard            Print a status dashboard
  promptrelay path                 Print ~/.promptrelay path
  promptrelay --version            Print version
  promptrelay --help               Show this help
`);
}

// --- init -------------------------------------------------------------------

function init({ quiet = false } = {}) {
  io.ensureHome();
  const created = [];
  const OPENCODE_EXAMPLE = path.join(io.HOME, 'opencode.jsonc.example');

  if (io.copyIfMissing(path.join(io.PACKAGE_ROOT, 'promptrelay.json'), io.CONFIG_FILE)) {
    created.push(io.CONFIG_FILE);
  }
  if (!fs.existsSync(io.PROMPT_FILE)) {
    fs.writeFileSync(io.PROMPT_FILE, `${io.PLACEHOLDER}\n`, 'utf8');
    created.push(io.PROMPT_FILE);
  }
  if (io.copyIfMissing(path.join(io.PACKAGE_ROOT, 'opencode.jsonc.example'), OPENCODE_EXAMPLE)) {
    created.push(OPENCODE_EXAMPLE);
  }

  if (quiet) return created;

  console.log('');
  console.log('⚡ PromptRelay initialized');
  console.log(`   Home   : ${io.HOME}`);
  console.log(`   Config : ${io.CONFIG_FILE}`);
  console.log(`   Prompt : ${io.PROMPT_FILE}`);
  console.log('');
  console.log(created.length
    ? `Created ${created.length} file${created.length === 1 ? '' : 's'}.`
    : 'Existing configuration kept unchanged.');
  console.log('');
  console.log('For the easiest setup, run:  promptrelay setup');
  console.log('');
  return created;
}

// --- provider management ----------------------------------------------------

function providerList() {
  const raw = readRawConfig();
  const registry = raw.providers || {};
  console.log('');
  console.log('Provider profiles:');
  const active = raw.activeProvider;
  const names = Object.keys(registry);
  if (raw.provider) {
    console.log(`  * (inline)      ${raw.provider.name} → ${raw.provider.model} [${raw.provider.transport}]${!active ? '  ← active' : ''}`);
  }
  if (!names.length) {
    console.log('  (no named profiles — add one with `promptrelay provider add`)');
  }
  for (const name of names) {
    const p = registry[name];
    const marker = active === name ? '  ← active' : '';
    console.log(`  - ${name.padEnd(14)} ${p.name} → ${p.model} [${p.transport}]${marker}`);
  }
  console.log('');
}

function providerUse(name) {
  const raw = readRawConfig();
  if (!raw.providers || !raw.providers[name]) {
    console.error(`No provider profile named "${name}". Run \`promptrelay provider list\`.`);
    process.exitCode = 1;
    return;
  }
  raw.activeProvider = name;
  raw.provider = { ...(raw.provider || {}), ...raw.providers[name] };
  saveRawConfig(raw);
  console.log(`✅ Active provider is now "${name}" → ${raw.providers[name].model}`);
}

function providerRemove(name) {
  const raw = readRawConfig();
  if (!raw.providers || !raw.providers[name]) {
    console.error(`No provider profile named "${name}".`);
    process.exitCode = 1;
    return;
  }
  delete raw.providers[name];
  if (raw.activeProvider === name) delete raw.activeProvider;
  saveRawConfig(raw);
  console.log(`✅ Removed provider profile "${name}".`);
}

async function providerTest({ live = false } = {}) {
  const config = loadUserConfig();
  const health = require('../providers/health');
  console.log('');
  console.log(`🔌 Testing provider "${config.provider.name}" (${live ? 'live' : 'safe'} mode)…`);
  const result = live ? await health.liveCheck(config) : await health.safeCheck(config);
  console.log(`   URL      : ${result.url}`);
  console.log(`   Status   : ${result.status}`);
  console.log(`   Latency  : ${result.latencyMs}ms`);
  console.log(`   Result   : ${result.ok ? '✅ healthy' : '❌ failed'}`);
  if (result.error) console.log(`   Error    : ${result.error}`);
  console.log('');
  process.exitCode = result.ok ? 0 : 1;
}

// --- models -----------------------------------------------------------------

async function modelsList({ json = false, refresh = false } = {}) {
  const config = loadUserConfig();
  const { discoverModels } = require('../models');
  const result = await discoverModels(config, { refresh });

  if (result.error) {
    console.error(`❌ Model discovery failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log(`Models for ${config.provider.name} (source: ${result.source}${result.cached ? ', cached' : ''}):`);
  console.log(`Retrieved: ${result.retrievedAt}`);
  console.log('');
  for (const m of result.models.slice(0, 100)) {
    const ctx = m.contextWindow === 'unknown' ? 'ctx:?' : `ctx:${m.contextWindow}`;
    const price = m.free === true ? 'FREE' : (m.inputPrice === 'unknown' ? '$?' : `$${Number(m.inputPrice).toFixed(2)}/1M`);
    const caps = [m.tools === true ? 'tools' : '', m.vision === true ? 'vision' : '', m.reasoning === true ? 'reasoning' : ''].filter(Boolean).join(',');
    console.log(`  ${m.id.padEnd(40)} ${ctx.padEnd(12)} ${price.padEnd(10)} ${caps}`);
  }
  console.log('');
  console.log(`Total: ${result.models.length} models`);
  console.log('');
}

async function modelsFree() {
  const config = loadUserConfig();
  const { discoverModels } = require('../models');
  const result = await discoverModels(config, {});
  if (result.error) {
    console.error(`❌ Model discovery failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const free = result.models.filter((m) => m.free === true);
  console.log('');
  console.log(`Verified free models for ${config.provider.name}: ${free.length}`);
  console.log('');
  for (const m of free) {
    const ctx = m.contextWindow === 'unknown' ? 'ctx:?' : `ctx:${m.contextWindow}`;
    console.log(`  ${m.id.padEnd(44)} ${ctx}`);
  }
  console.log('');
  if (!free.length) {
    console.log('No models had metadata explicitly confirming zero cost.');
    console.log('');
  }
}

async function modelsRefresh() {
  const config = loadUserConfig();
  const { discoverModels } = require('../models');
  const result = await discoverModels(config, { refresh: true });
  if (result.error) {
    console.error(`❌ Refresh failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Refreshed ${result.models.length} models (expires ${result.expiresAt}).`);
}

async function modelsRecommend({ profile = 'balanced' } = {}) {
  const config = loadUserConfig();
  const { discoverModels, recommend, PROFILES } = require('../models');
  if (!PROFILES.includes(profile)) {
    console.error(`Unknown profile "${profile}". Options: ${PROFILES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const result = await discoverModels(config, {});
  if (result.error) {
    console.error(`❌ Model discovery failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const rec = recommend(result.models, profile);
  console.log('');
  console.log(`🎯 Recommendation for "${profile}":`);
  if (!rec.model) {
    console.log(`   ${rec.explanation}`);
    console.log('');
    process.exitCode = 1;
    return;
  }
  console.log(`   ${rec.explanation}`);
  if (rec.alternatives.length) {
    console.log('   Alternatives:');
    for (const alt of rec.alternatives) console.log(`     - ${alt.id} (score ${alt.score})`);
  }
  console.log('');
  console.log(`Set it with:  promptrelay model use ${rec.model.id}`);
  console.log('');
  return rec;
}

function modelUse(id) {
  if (!id) {
    console.error('Usage: promptrelay model use <model-id>');
    process.exitCode = 1;
    return;
  }
  const raw = readRawConfig();
  raw.provider = raw.provider || {};
  raw.provider.model = id;
  if (raw.activeProvider && raw.providers?.[raw.activeProvider]) {
    raw.providers[raw.activeProvider].model = id;
  }
  saveRawConfig(raw);
  console.log(`✅ Active model set to "${id}".`);
}

async function auto({ profile = 'balanced' } = {}) {
  const rec = await modelsRecommend({ profile });
  if (rec && rec.model) {
    modelUse(rec.model.id);
  }
}

// --- reasoning --------------------------------------------------------------

function reasoningList() {
  const { LEVELS } = require('../reasoning');
  console.log('');
  console.log('Reasoning levels (low → high effort):');
  console.log(`  ${LEVELS.join('  →  ')}`);
  console.log('  auto   PromptRelay picks per-request');
  console.log('');
}

function reasoningSet(level) {
  const { normalizeReasoning } = require('../reasoning');
  const raw = readRawConfig();
  raw.reasoning = raw.reasoning || {};
  if (String(level).toLowerCase() === 'auto') {
    raw.reasoning.auto = true;
    saveRawConfig(raw);
    console.log('✅ Reasoning set to auto.');
    return;
  }
  const normalized = normalizeReasoning(level, null);
  if (!normalized) {
    console.error(`Invalid reasoning level "${level}". Run \`promptrelay reasoning list\`.`);
    process.exitCode = 1;
    return;
  }
  raw.reasoning.auto = false;
  raw.reasoning.default = normalized;
  saveRawConfig(raw);
  console.log(`✅ Default reasoning set to "${normalized}".`);
}

// --- prompt -----------------------------------------------------------------

function promptUse(file) {
  if (!file || !fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exitCode = 1;
    return;
  }
  io.ensureHome();
  const content = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(io.PROMPT_FILE, content, 'utf8');
  console.log(`✅ Loaded prompt from ${file} (${content.length} chars).`);
}

function openFile(file) {
  io.ensureHome();
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
    console.log('Set $EDITOR to open it automatically, e.g. export EDITOR=nano');
    return;
  }
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.log(file);
    console.error(`Could not open editor: ${result.error.message}`);
  }
}

// --- opencode ---------------------------------------------------------------

async function opencodeSetup() {
  const config = loadUserConfig();
  const opencode = require('../opencode');
  const { discoverModels } = require('../models');

  const baseURL = `http://${config.server.host}:${config.server.port}/v1`;
  let modelMeta = null;
  try {
    const result = await discoverModels(config, {});
    if (!result.error) {
      modelMeta = result.models.find((m) => m.id === config.provider.model) || null;
    }
  } catch {}

  const res = opencode.setupOpenCode({ baseURL, model: config.provider.model, modelMeta });
  console.log('');
  console.log(res.created ? '✅ OpenCode config created.' : '✅ PromptRelay provider merged into OpenCode config.');
  console.log(`   Path   : ${res.path}`);
  if (res.backupPath) console.log(`   Backup : ${res.backupPath}`);
  console.log(`   Model  : ${config.provider.model}${modelMeta && modelMeta.contextWindow !== 'unknown' ? ` (ctx ${modelMeta.contextWindow})` : ' (limits unknown — not fabricated)'}`);
  console.log('');
}

function opencodeStatus() {
  const opencode = require('../opencode');
  const status = opencode.statusOpenCode();
  console.log('');
  console.log('OpenCode integration:');
  console.log(`   Config found : ${status.found ? 'yes' : 'no'}`);
  console.log(`   Path         : ${status.path}`);
  if (status.found) {
    if (status.valid === false) {
      console.log(`   Valid JSONC  : ❌ ${status.error}`);
      process.exitCode = 1;
    } else {
      console.log(`   PromptRelay  : ${status.hasPromptRelay ? '✅ configured' : '❌ not configured'}`);
      if (status.models?.length) console.log(`   Models       : ${status.models.join(', ')}`);
    }
  }
  console.log('');
}

// --- keys -------------------------------------------------------------------

function keysSet(name, value) {
  if (!name || value === undefined) {
    console.error('Usage: promptrelay keys set <ENV_NAME> <value>');
    process.exitCode = 1;
    return;
  }
  io.writeEnvValue(name, value);
  console.log(`✅ Stored ${name} = ${maskSecret(value)} in ${io.ENV_FILE}`);
}

function keysList() {
  const keys = io.listEnvKeys();
  console.log('');
  console.log('Stored keys (values masked, never displayed):');
  if (!keys.length) console.log('  (none)');
  for (const k of keys) console.log(`  - ${k}`);
  console.log('');
}

function keysRemove(name) {
  if (!name) {
    console.error('Usage: promptrelay keys remove <ENV_NAME>');
    process.exitCode = 1;
    return;
  }
  const removed = io.removeEnvValue(name);
  console.log(removed ? `✅ Removed ${name}.` : `No stored key named ${name}.`);
}

// --- config validate --------------------------------------------------------

function configValidate() {
  let config;
  try {
    config = loadUserConfig();
  } catch (error) {
    console.error(`❌ Config parse error: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { validateConfig } = require('../config');
  const problems = validateConfig(config);
  console.log('');
  if (!problems.length) {
    console.log('✅ Config is valid.');
  } else {
    console.log('❌ Config problems:');
    for (const p of problems) console.log(`   - ${p}`);
    process.exitCode = 1;
  }
  console.log('');
}

// --- doctor -----------------------------------------------------------------

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 18, version: process.versions.node, major };
}

async function doctor({ deep = false, fix = false } = {}) {
  io.ensureHome();
  process.env.PROMPTRELAY_CONFIG = process.env.PROMPTRELAY_CONFIG || io.CONFIG_FILE;

  const { loadConfig, validateConfig } = require('../config');
  const { promptConfigured } = require('../prompts');
  const { normalizeProviderURL, hasVersionSegment } = require('../providers/urls');

  console.log('');
  console.log('🩺 PromptRelay doctor');

  const node = checkNodeVersion();
  console.log(`   Node        : ${node.ok ? '✅' : '❌'} ${node.version}${node.ok ? '' : ' (requires >= 18)'}`);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`   Config      : ❌ ${error.message}`);
    console.log('');
    console.log('⚠️ Fix the JSON syntax, then re-run `promptrelay doctor`.');
    process.exitCode = 1;
    return;
  }

  const problems = validateConfig(config);
  const keyConfigured = Boolean(config.provider.apiKey) || config.provider.auth?.type === 'none';
  const promptOk = config.prompt.mode === 'passthrough' || promptConfigured(config);

  console.log(`   Provider    : ${config.provider.name}`);
  console.log(`   Transport   : ${config.provider.transport}`);
  console.log(`   Base URL    : ${config.provider.baseURL}`);
  console.log(`   Model       : ${config.provider.model}`);
  console.log(`   Prompt mode : ${config.prompt.mode}`);
  console.log(`   Prompt      : ${promptOk ? '✅ configured' : '❌ not configured'}`);
  console.log(`   API key     : ${keyConfigured ? '✅ configured' : `❌ missing (${config.provider.apiKeyEnv})`}`);
  console.log(`   Config      : ${config.paths.configFile}`);

  // URL sanity: detect /v1 duplication.
  const normalized = normalizeProviderURL(config.provider.baseURL);
  if (/\/v1\/v1/i.test(config.provider.baseURL)) {
    console.log(`   URL         : ⚠️ duplicated /v1 segment — should be ${normalized}`);
    if (fix) {
      const raw = readRawConfig();
      if (raw.provider) raw.provider.baseURL = normalized;
      if (raw.activeProvider && raw.providers?.[raw.activeProvider]) raw.providers[raw.activeProvider].baseURL = normalized;
      saveRawConfig(raw);
      console.log(`   URL         : 🔧 fixed → ${normalized}`);
    }
  }

  // Port conflict check.
  if (deep) {
    const inUse = await isPortInUse(config.server.host, config.server.port);
    console.log(`   Port ${config.server.port}   : ${inUse ? '⚠️ already in use (PromptRelay may already be running)' : '✅ free'}`);

    console.log('   Provider    : testing reachability (safe)…');
    const health = require('../providers/health');
    const result = await health.safeCheck(config);
    console.log(`   Reachable   : ${result.ok ? `✅ (${result.latencyMs}ms)` : `❌ ${result.error || 'status ' + result.status}`}`);
  }

  for (const problem of problems) console.log(`   Config      : ❌ ${problem}`);

  const ok = !problems.length && promptOk && keyConfigured && node.ok;
  console.log('');
  console.log(ok ? '✅ Ready to run.' : '⚠️ Run `promptrelay setup` to fix the setup interactively.');
  console.log('');
  process.exitCode = ok ? 0 : 1;
}

function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
    socket.connect(port, host === '0.0.0.0' ? '127.0.0.1' : host);
  });
}

// --- lifecycle --------------------------------------------------------------

function readPid() {
  try {
    const pid = Number(fs.readFileSync(io.PID_FILE, 'utf8').trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startServer({ daemon = false } = {}) {
  io.ensureHome();
  if (!fs.existsSync(io.CONFIG_FILE)) {
    init();
    console.log('Run `promptrelay setup` in a terminal, then start PromptRelay again.');
    return;
  }

  const existing = readPid();
  if (pidAlive(existing)) {
    console.log(`PromptRelay already running (pid ${existing}). Use \`promptrelay restart\`.`);
    return;
  }

  const env = { ...process.env, PROMPTRELAY_CONFIG: process.env.PROMPTRELAY_CONFIG || io.CONFIG_FILE };
  const serverPath = path.join(io.PACKAGE_ROOT, 'src', 'server.js');

  if (daemon) {
    const out = fs.openSync(path.join(io.HOME, 'promptrelay.log'), 'a');
    const child = spawn(process.execPath, [serverPath], {
      env,
      detached: true,
      stdio: ['ignore', out, out],
    });
    fs.writeFileSync(io.PID_FILE, String(child.pid), 'utf8');
    child.unref();
    console.log(`✅ PromptRelay started in background (pid ${child.pid}).`);
    console.log(`   Logs: ${path.join(io.HOME, 'promptrelay.log')}`);
    return;
  }

  const child = spawn(process.execPath, [serverPath], { stdio: 'inherit', env });
  fs.writeFileSync(io.PID_FILE, String(child.pid), 'utf8');
  child.on('exit', (code, signal) => {
    try { fs.unlinkSync(io.PID_FILE); } catch {}
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function stopServer() {
  const pid = readPid();
  if (!pidAlive(pid)) {
    console.log('PromptRelay is not running.');
    try { fs.unlinkSync(io.PID_FILE); } catch {}
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    try { fs.unlinkSync(io.PID_FILE); } catch {}
    console.log(`✅ Stopped PromptRelay (pid ${pid}).`);
  } catch (error) {
    console.error(`Could not stop pid ${pid}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function restartServer() {
  stopServer();
  await new Promise((r) => setTimeout(r, 600));
  await startServer({ daemon: true });
}

async function status() {
  const pid = readPid();
  const running = pidAlive(pid);
  const config = loadUserConfig();
  console.log('');
  console.log('PromptRelay status:');
  console.log(`   Process : ${running ? `✅ running (pid ${pid})` : '⛔ not running'}`);
  console.log(`   Provider: ${config.provider.name} → ${config.provider.model}`);
  console.log(`   URL     : http://${config.server.host}:${config.server.port}`);

  if (running) {
    try {
      const res = await fetch(`http://${config.server.host}:${config.server.port}/health`);
      const health = await res.json();
      console.log(`   Health  : ${health.status}`);
      console.log(`   Prompt  : ${health.promptConfigured ? 'configured' : 'not configured'}`);
    } catch (error) {
      console.log(`   Health  : unreachable (${error.message})`);
    }
  }
  console.log('');
}

async function dashboard() {
  const config = loadUserConfig();
  const { validateConfig } = require('../config');
  const { promptConfigured } = require('../prompts');
  const problems = validateConfig(config);
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('⚡ PROMPTRELAY DASHBOARD');
  console.log('══════════════════════════════════════════════');
  console.log(`Provider   : ${config.provider.name} [${config.provider.transport}]`);
  console.log(`Base URL   : ${config.provider.baseURL}`);
  console.log(`Model      : ${config.provider.model}`);
  console.log(`Prompt     : ${config.prompt.mode} (${promptConfigured(config) ? 'configured' : 'placeholder'})`);
  console.log(`Reasoning  : ${config.reasoning.auto ? 'auto' : config.reasoning.default}`);
  console.log(`Fallback   : ${config.fallback?.enabled ? config.fallback.providers.join(' → ') : 'disabled'}`);
  console.log(`Retry      : ${config.retry?.enabled ? `up to ${config.retry.maxRetries}` : 'disabled'}`);
  console.log(`Config     : ${problems.length ? `❌ ${problems.length} problem(s)` : '✅ valid'}`);
  console.log('══════════════════════════════════════════════');
  console.log('');
  await status();
}

module.exports = {
  loadUserConfig,
  readRawConfig,
  saveRawConfig,
  version,
  printHelp,
  init,
  providerList,
  providerUse,
  providerRemove,
  providerTest,
  modelsList,
  modelsFree,
  modelsRefresh,
  modelsRecommend,
  modelUse,
  auto,
  reasoningList,
  reasoningSet,
  promptUse,
  openFile,
  opencodeSetup,
  opencodeStatus,
  keysSet,
  keysList,
  keysRemove,
  configValidate,
  doctor,
  startServer,
  stopServer,
  restartServer,
  status,
  dashboard,
};
