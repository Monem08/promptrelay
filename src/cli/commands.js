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
  promptrelay setup [--auto] [--dry-run] [--no-start]  Setup wizard (auto/dry-run supported)
  promptrelay start                                    Start the gateway
  promptrelay doctor [--deep] [--fix]                  Diagnose and repair your configuration

Lifecycle:
  promptrelay start [--daemon]                         Start (foreground, or background with --daemon)
  promptrelay stop                                     Stop a running gateway
  promptrelay restart                                  Restart the gateway
  promptrelay status                                   Show running status + live /health

Service (OS Daemon):
  promptrelay service install                          Install user-level background service
  promptrelay service start                            Start background service
  promptrelay service stop                             Stop background service
  promptrelay service restart                          Restart background service
  promptrelay service status                           Show background service status
  promptrelay service uninstall                        Uninstall background service

Providers:
  promptrelay provider                                 Interactive provider/model wizard
  promptrelay provider list                            List configured provider profiles
  promptrelay provider add                             Add a provider profile (interactive)
  promptrelay provider use <name>                      Switch the active provider profile
  promptrelay provider test [--live]                   Health-check the active provider
  promptrelay provider remove <name>                   Remove a provider profile

Models:
  promptrelay models list [--json]                     Discover & list provider models
  promptrelay models free                              List verified free models
  promptrelay models refresh [--clear]                 Refresh (or clear) the model cache
  promptrelay models recommend [--profile <p>]         Recommend a model
  promptrelay model use <id>                           Set the active model

Auto & reasoning:
  promptrelay auto [--profile <p>]                     Auto-select the best model for a profile
  promptrelay reasoning list                           List reasoning levels
  promptrelay reasoning set <lvl>                      Set default reasoning (none…max, or auto)

Prompt & config:
  promptrelay prompt                                   Open your custom system prompt
  promptrelay prompt use <file>                        Load a prompt from a file
  promptrelay config                                   Open the config file
  promptrelay config validate                          Validate the config
  promptrelay config migrate [--dry-run]               Migrate config schema with backups
  promptrelay config backups                           List timestamped configuration backups
  promptrelay config restore <id>                      Restore configuration from a backup

OpenCode:
  promptrelay opencode                                 Set up OpenCode integration
  promptrelay opencode status                          Show OpenCode integration status
  promptrelay opencode repair                          Re-merge the PromptRelay provider

Clients (multi-client integration):
  promptrelay client list                              List supported clients (OpenCode, Claude Code, Hermes)
  promptrelay client detect                            Detect which clients are installed/configured
  promptrelay client status [id]                       Show PromptRelay wiring status for a client (or all)
  promptrelay client setup <id>                        Wire a client to PromptRelay (--model, --small-model)
  promptrelay client repair <id>                       Re-apply the PromptRelay wiring for a client
  promptrelay client validate <id>                     Validate client configuration against expected schema
  promptrelay client remove <id>                       Remove PromptRelay wiring (restores backup-safe)

Compatibility aliases:
  promptrelay repair <client>                          Alias for promptrelay client repair <client>
  promptrelay refresh --clear                          Alias for promptrelay models refresh --clear

Keys:
  promptrelay keys set <ENV> <val>                     Store a secret in ~/.promptrelay/.env
  promptrelay keys list                                List stored key names (masked)
  promptrelay keys remove <ENV>                        Remove a stored secret

Other:
  promptrelay init                                     Create config files without overwriting
  promptrelay dashboard                                Open the web dashboard (starts gateway if needed)
  promptrelay dashboard --print                        Print the terminal status dashboard instead
  promptrelay path                                     Print ~/.promptrelay path
  promptrelay --version                                Print version
  promptrelay --help                                   Show this help
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

async function modelsRefresh({ clear = false } = {}) {
  const config = loadUserConfig();
  if (clear) {
    const { clearCache } = require('../models/cache');
    clearCache(config);
    console.log('✅ Model cache cleared.');
  }
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

// --- clients ----------------------------------------------------------------

/** PromptRelay base URL for a client, respecting each client's protocol. */
function clientBaseURL(client, config) {
  return client.defaultBaseURL(config.server);
}

function clientList() {
  const { listClients } = require('../clients/registry');
  console.log('');
  console.log('Supported clients:');
  for (const c of listClients()) {
    const ingress = c.protocol === 'anthropic' ? 'POST /v1/messages' : 'POST /v1/chat/completions';
    console.log(`  - ${c.id.padEnd(12)} ${c.label.padEnd(14)} [${c.protocol}] → ${ingress}`);
  }
  console.log('');
  console.log('Set one up with:  promptrelay client setup <id>');
  console.log('');
}

function clientDetect() {
  const { detectAll } = require('../clients/registry');
  console.log('');
  console.log('Detected clients (by config presence):');
  for (const d of detectAll()) {
    console.log(`  - ${d.label.padEnd(14)} ${d.installed ? '✅ config found' : '— not found'}  ${d.path}`);
  }
  console.log('');
}

function clientStatus(id) {
  const { getClient, statusAll } = require('../clients/registry');
  const entries = id ? [getClient(id)].filter(Boolean).map((c) => c.status()) : statusAll();
  if (id && !entries.length) {
    console.error(`Unknown client "${id}". Run \`promptrelay client list\`.`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  for (const s of entries) {
    console.log(`${s.label} [${s.protocol}]`);
    console.log(`   Config found : ${s.found ? 'yes' : 'no'}`);
    console.log(`   Path         : ${s.path}`);
    if (s.found && s.valid === false) {
      console.log(`   Valid        : ❌ ${s.error}`);
    } else if (s.found) {
      console.log(`   PromptRelay  : ${s.configured ? '✅ configured' : '❌ not configured'}`);
      if (s.details) {
        for (const [k, v] of Object.entries(s.details)) {
          if (v !== undefined && v !== null) console.log(`     ${k} = ${v}`);
        }
      }
      if (s.models && s.models.length) console.log(`   Models       : ${s.models.join(', ')}`);
    }
    console.log('');
  }
}

async function clientSetup(id, { model, smallModel } = {}) {
  const { getClient } = require('../clients/registry');
  const client = getClient(id);
  if (!client) {
    console.error(`Unknown client "${id}". Run \`promptrelay client list\`.`);
    process.exitCode = 1;
    return;
  }
  const config = loadUserConfig();
  const baseURL = clientBaseURL(client, config);
  const chosenModel = model || config.provider.model;

  // For OpenCode, attach verified model metadata when available (never fabricated).
  let modelMeta = null;
  if (client.id === 'opencode') {
    try {
      const { discoverModels } = require('../models');
      const result = await discoverModels(config, {});
      if (!result.error) modelMeta = result.models.find((m) => m.id === chosenModel) || null;
    } catch { /* discovery is best-effort */ }
  }

  let res;
  try {
    res = client.configure({ baseURL, model: chosenModel, smallModel, modelMeta });
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(res.created ? `✅ ${client.label} config created.` : `✅ PromptRelay wired into ${client.label} (existing config preserved).`);
  console.log(`   Path     : ${res.path}`);
  if (res.envPath) console.log(`   Env file : ${res.envPath}`);
  if (res.backupPath) console.log(`   Backup   : ${res.backupPath}`);
  console.log(`   Endpoint : ${baseURL}${client.protocol === 'anthropic' ? '  (Anthropic Messages ingress)' : '  (OpenAI-compatible ingress)'}`);
  console.log(`   Model    : ${chosenModel}`);
  console.log('   Note     : No upstream provider key was written to the client; PromptRelay holds your credentials.');
  console.log('');
}

function clientRemove(id) {
  const { getClient } = require('../clients/registry');
  const client = getClient(id);
  if (!client) {
    console.error(`Unknown client "${id}". Run \`promptrelay client list\`.`);
    process.exitCode = 1;
    return;
  }
  const res = client.remove();
  console.log('');
  if (res.removed) {
    console.log(`✅ Removed PromptRelay from ${client.label}.`);
    console.log(`   Path   : ${res.path}`);
    if (res.backupPath) console.log(`   Backup : ${res.backupPath}`);
  } else {
    console.log(`ℹ️ ${res.note || 'Nothing to remove.'}`);
  }
  console.log('');
}

async function clientValidate(id, { live = false } = {}) {
  const { getClient, listClients } = require('../clients/registry');
  const targetIds = id ? [id] : listClients().map((c) => c.id);

  console.log('');
  console.log('🧪 Client configuration & validation:');

  for (const clientId of targetIds) {
    const client = getClient(clientId);
    if (!client) {
      console.log(`  ❌ Unknown client "${clientId}"`);
      continue;
    }
    const status = client.status();
    console.log(`\n  Client: ${client.label} [${client.protocol}]`);
    console.log(`     Installed   : ${status.found ? '✅ yes' : '— not found'}`);
    console.log(`     Configured  : ${status.configured ? '✅ yes' : '❌ not configured'}`);
    console.log(`     Config Path : ${status.path}`);
    if (status.details) {
      for (const [k, v] of Object.entries(status.details)) {
        console.log(`     ${k} = ${v}`);
      }
    }
  }
  console.log('');
}

// --- service management -----------------------------------------------------

function serviceStatus() {
  const service = require('../service/manager');
  const s = service.status();
  console.log('');
  console.log('PromptRelay Background Service:');
  console.log(`   Platform     : ${s.platform}`);
  console.log(`   Service Type : ${s.serviceType}`);
  console.log(`   Installed    : ${s.installed ? '✅ installed' : '❌ not installed'}`);
  console.log(`   Running      : ${s.running ? '✅ running' : '⏸ not running'}`);
  if (s.path) console.log(`   Service File : ${s.path}`);
  if (s.details) console.log(`   Details      : ${s.details}`);
  console.log('');
  if (!s.installed) {
    console.log('To install as background service:  promptrelay service install');
  } else if (!s.running) {
    console.log('To start background service:       promptrelay service start');
  }
  console.log('');
}

function serviceInstall() {
  const service = require('../service/manager');
  console.log('');
  try {
    const res = service.install({ envFile: io.ENV_FILE });
    console.log('✅ Background service successfully installed.');
    console.log(`   Type : ${res.serviceType}`);
    if (res.path) console.log(`   Path : ${res.path}`);
    console.log('Start it now with:  promptrelay service start');
  } catch (err) {
    console.error(`❌ Failed to install service: ${err.message}`);
    process.exitCode = 1;
  }
  console.log('');
}

function serviceUninstall() {
  const service = require('../service/manager');
  console.log('');
  const res = service.uninstall();
  if (res.success) {
    console.log('✅ Background service uninstalled.');
  } else {
    console.log(`ℹ️ ${res.note || res.error || 'Failed to uninstall.'}`);
  }
  console.log('');
}

function serviceStart() {
  const service = require('../service/manager');
  console.log('');
  try {
    service.start();
    console.log('✅ Background service start command issued.');
  } catch (err) {
    console.error(`❌ Failed to start service: ${err.message}`);
    process.exitCode = 1;
  }
  console.log('');
}

function serviceStop() {
  const service = require('../service/manager');
  console.log('');
  try {
    service.stop();
    console.log('✅ Background service stopped.');
  } catch (err) {
    console.error(`❌ Failed to stop service: ${err.message}`);
    process.exitCode = 1;
  }
  console.log('');
}

function serviceRestart() {
  const service = require('../service/manager');
  console.log('');
  try {
    service.restart();
    console.log('✅ Background service restarted.');
  } catch (err) {
    console.error(`❌ Failed to restart service: ${err.message}`);
    process.exitCode = 1;
  }
  console.log('');
}

// --- config commands --------------------------------------------------------

function configValidate() {
  const config = loadUserConfig();
  const { validateConfig } = require('../config');
  const problems = validateConfig(config);
  console.log('');
  if (problems.length) {
    console.log(`❌ Configuration has ${problems.length} problem(s):`);
    for (const p of problems) console.log(`   - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('✅ Configuration is valid.');
    console.log(`   Config file : ${config.paths.configFile}`);
    console.log(`   Version     : ${config.version}`);
  }
  console.log('');
}

async function configMigrate({ dryRun = false } = {}) {
  const { migrateConfigFile } = require('../config/migrate');
  const file = io.CONFIG_FILE;
  if (!fs.existsSync(file)) {
    console.log('No user configuration file found to migrate.');
    return;
  }
  const res = migrateConfigFile(file, { dryRun });
  console.log('');
  if (!res.migrated) {
    console.log(`ℹ️ Configuration is already at the latest schema version (v${res.toVersion}).`);
  } else if (res.dryRun) {
    console.log(`🔍 Dry-run migration: would upgrade from v${res.fromVersion} to v${res.toVersion}.`);
    console.log('   Zero filesystem mutations performed.');
  } else {
    console.log(`✅ Successfully migrated config from v${res.fromVersion} to v${res.toVersion}.`);
    if (res.backupPath) console.log(`   Backup saved to : ${res.backupPath}`);
  }
  console.log('');
}

function configBackups() {
  const { listBackups } = require('../config/safe-write');
  const backups = listBackups(io.CONFIG_FILE);
  console.log('');
  console.log(`Configuration backups for ${io.CONFIG_FILE}:`);
  if (!backups.length) {
    console.log('   (No backups found)');
  } else {
    backups.forEach((b, i) => {
      console.log(`   [${i}] ${b.name} (${b.size} bytes, ${b.mtime.toISOString()})`);
    });
  }
  console.log('');
}

function configRestore(target) {
  const backups = require('../config/backups');
  console.log('');
  if (target === undefined || target === null || target === '') {
    const res = backups.restoreByIndex(io.CONFIG_FILE, 0);
    if (!res.restored) {
      console.error(`❌ Restore failed: ${res.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ Restored most recent backup: ${res.backupName}`);
    if (res.previousBackup) console.log(`   Pre-restore backup saved to: ${res.previousBackup}`);
  } else if (/^\d+$/.test(String(target))) {
    const idx = parseInt(target, 10);
    const res = backups.restoreByIndex(io.CONFIG_FILE, idx);
    if (!res.restored) {
      console.error(`❌ Restore failed: ${res.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ Restored backup #${idx}: ${res.backupName}`);
    if (res.previousBackup) console.log(`   Pre-restore backup saved to: ${res.previousBackup}`);
  } else {
    const res = backups.restoreByPath(target, io.CONFIG_FILE);
    if (!res.restored) {
      console.error(`❌ Restore failed: ${res.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ Restored backup file: ${target}`);
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

  const doctorEngine = require('../doctor');
  const { loadConfig, validateConfig } = require('../config');
  const { promptConfigured } = require('../prompts');
  const { normalizeProviderURL } = require('../providers/urls');

  console.log('');
  console.log('🩺 PromptRelay doctor');

  if (fix) {
    console.log('🔧 Running automated repair…');
    const repairResult = await doctorEngine.repair({ deep });
    if (repairResult.repaired.length) {
      console.log('\n  Repairs applied:');
      for (const r of repairResult.repaired) console.log(`   ✅ ${r}`);
    } else {
      console.log('  No automated repairs were needed.');
    }
    console.log('');
  }

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

  // Client statuses
  const clientStatuses = doctorEngine.checkClients();
  console.log('   Clients     :');
  for (const c of clientStatuses.clients) {
    const statusIcon = c.found ? (c.configured ? '✅ configured' : '⚠️ installed but not configured') : '— not found';
    console.log(`     - ${c.label.padEnd(12)}: ${statusIcon}`);
  }

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
  console.log(ok ? '✅ Ready to run.' : '⚠️ Run `promptrelay doctor --fix` or `promptrelay setup` to repair issues.');
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

// Print the classic terminal status dashboard (kept for `promptrelay dashboard --print`).
async function dashboardPrint() {
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

// Open the web dashboard in the default browser, starting the gateway if needed.
async function dashboard(opts = {}) {
  if (opts.print) {
    await dashboardPrint();
    return;
  }

  const config = loadUserConfig();
  const host = config.server?.host || '127.0.0.1';
  const port = config.server?.port || 4141;
  // Loopback address the browser should target (never advertise 0.0.0.0).
  const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${browserHost}:${port}/dashboard`;

  let running = await isPortInUse(host, port);

  if (!running) {
    console.log('Starting PromptRelay gateway…');
    await startServer({ daemon: true });
    // Wait for the port to accept connections (up to ~8s).
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isPortInUse(host, port)) { running = true; break; }
    }
    if (!running) {
      console.log('⚠️ Gateway did not come up in time. Check `promptrelay status`.');
      console.log(`   Once it is running, open: ${url}`);
      return;
    }
  } else {
    console.log('PromptRelay gateway already running.');
  }

  console.log(`Opening dashboard → ${url}`);
  const opened = openInBrowser(url);
  if (!opened) {
    console.log('Could not launch a browser automatically.');
    console.log(`Open this URL manually: ${url}`);
  }
}

// Best-effort cross-platform browser launcher. Returns true if a launcher was spawned.
function openInBrowser(url) {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
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
  clientBaseURL,
  clientList,
  clientDetect,
  clientStatus,
  clientSetup,
  clientRemove,
  clientValidate,
  serviceStatus,
  serviceInstall,
  serviceUninstall,
  serviceStart,
  serviceStop,
  serviceRestart,
  keysSet,
  keysList,
  keysRemove,
  configValidate,
  configMigrate,
  configBackups,
  configRestore,
  doctor,
  startServer,
  stopServer,
  restartServer,
  status,
  dashboard,
  dashboardPrint,
};

