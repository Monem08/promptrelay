'use strict';

/**
 * Self-healing diagnostics and repair engine for PromptRelay.
 *
 * Runs structured health checks across:
 *   - Node runtime
 *   - Config validity and schema migrations
 *   - Provider credentials & reachability
 *   - Global and scoped prompt files
 *   - Client integrations (OpenCode, Claude Code, Hermes)
 *   - Port conflicts and server status
 *
 * Provides `repair()` to automatically resolve common issues:
 *   - Auto-migrating older schema versions
 *   - Restoring from backup on corrupted config
 *   - Creating missing prompt files
 *   - Auto-attaching detected environment credentials
 *   - Repairing or configuring client adapters
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const io = require('../cli/io');
const { loadConfig, validateConfig, CONFIG_VERSION, USER_CONFIG_FILE } = require('../config');
const { migrateConfigFile } = require('../config/migrate');
const { listBackups, restoreBackup } = require('../config/safe-write');
const { ensurePromptFile, promptConfigured } = require('../prompts');
const { normalizeProviderURL } = require('../providers/urls');
const credentials = require('../providers/credentials');
const registry = require('../clients/registry');

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 18;
  return {
    ok,
    name: 'Node.js Runtime',
    version: process.versions.node,
    message: ok ? `Node.js v${process.versions.node}` : `Node.js v${process.versions.node} (requires >= 18)`,
  };
}

function checkConfigFile() {
  const file = process.env.PROMPTRELAY_CONFIG || io.CONFIG_FILE;
  if (!fs.existsSync(file)) {
    return { ok: false, name: 'Configuration File', error: `Config file not found at ${file}` };
  }

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    const version = json.version || 1;
    const isOutdated = version < CONFIG_VERSION;
    return {
      ok: true,
      name: 'Configuration File',
      path: file,
      version,
      isOutdated,
      message: `v${version}${isOutdated ? ` (latest: v${CONFIG_VERSION})` : ''}`,
    };
  } catch (err) {
    return { ok: false, name: 'Configuration File', path: file, corrupted: true, error: err.message };
  }
}

function checkPrompt(config) {
  const file = config?.paths?.promptFile || io.PROMPT_FILE;
  const exists = fs.existsSync(file);
  const isConfigured = promptConfigured(config || { paths: { promptFile: file }, prompt: {} });
  const isPassthrough = config?.prompt?.mode === 'passthrough';

  const ok = exists && (isPassthrough || isConfigured);
  return {
    ok,
    name: 'System Prompt',
    path: file,
    exists,
    configured: isConfigured,
    mode: config?.prompt?.mode || 'replace',
    message: !exists
      ? 'Prompt file missing'
      : !isConfigured && !isPassthrough
        ? 'Prompt placeholder has not been replaced'
        : 'Prompt configured',
  };
}

function checkCredentials(config) {
  const hasKey = Boolean(config?.provider?.apiKey) || config?.provider?.auth?.type === 'none';
  const detected = credentials.detectedCredentials();

  return {
    ok: hasKey,
    name: 'Provider Credentials',
    configured: hasKey,
    apiKeyEnv: config?.provider?.apiKeyEnv || 'PROVIDER_API_KEY',
    detectedEnvs: detected.map((d) => d.envVar),
    message: hasKey
      ? 'API key configured'
      : detected.length
        ? `Missing, but found credentials in env: ${detected.map((d) => d.envVar).join(', ')}`
        : 'API key missing',
  };
}

function checkClients() {
  const statuses = registry.statusAll();
  return {
    name: 'Client Integrations',
    clients: statuses,
  };
}

async function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(600);
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

/**
 * Run a full diagnostic check.
 *
 * @param {object} [options]
 * @param {boolean} [options.deep=false]
 * @returns {Promise<{ ok: boolean, checks: object, problems: string[], recommendations: string[] }>}
 */
async function diagnose({ deep = false } = {}) {
  const problems = [];
  const recommendations = [];

  const node = checkNode();
  if (!node.ok) problems.push(node.message);

  const configFile = checkConfigFile();
  if (!configFile.ok) {
    problems.push(`Config file: ${configFile.error}`);
    recommendations.push('Run `promptrelay doctor --fix` or `promptrelay setup` to repair configuration.');
  }

  let config = null;
  if (configFile.ok) {
    try {
      config = loadConfig();
      const valProblems = validateConfig(config);
      problems.push(...valProblems);
    } catch (e) {
      problems.push(`Failed to parse config: ${e.message}`);
    }
  }

  const prompt = checkPrompt(config);
  if (!prompt.ok) {
    problems.push(`Prompt: ${prompt.message}`);
    recommendations.push(`Edit ${prompt.path} or set prompt mode to "passthrough".`);
  }

  const creds = checkCredentials(config);
  if (!creds.ok) {
    problems.push(`Credentials: ${creds.message}`);
    if (creds.detectedEnvs.length) {
      recommendations.push(`Use detected environment variable: ${creds.detectedEnvs[0]}`);
    } else {
      recommendations.push('Add an API key using `promptrelay keys set <KEY>` or in ~/.promptrelay/.env');
    }
  }

  const clients = checkClients();

  let reachability = null;
  let portStatus = null;

  if (deep && config) {
    const inUse = await isPortInUse(config.server.host, config.server.port);
    portStatus = { port: config.server.port, inUse };

    try {
      const health = require('../providers/health');
      const res = await health.safeCheck(config);
      reachability = res;
      if (!res.ok) {
        problems.push(`Provider upstream unreachable: ${res.error || res.status}`);
      }
    } catch (err) {
      reachability = { ok: false, error: err.message };
      problems.push(`Provider health check failed: ${err.message}`);
    }
  }

  const ok = problems.length === 0;

  return {
    ok,
    checks: {
      node,
      config: configFile,
      prompt,
      credentials: creds,
      clients,
      portStatus,
      reachability,
    },
    problems,
    recommendations,
  };
}

/**
 * Automatically repair detected issues where safe to do so.
 *
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, repaired: string[], remainingProblems: string[] }>}
 */
async function repair(options = {}) {
  const repaired = [];
  const configFile = process.env.PROMPTRELAY_CONFIG || io.CONFIG_FILE;

  // 1. Repair corrupted config if backup exists
  if (fs.existsSync(configFile)) {
    try {
      JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {
      const backups = listBackups(configFile);
      if (backups.length > 0) {
        restoreBackup(backups[0].path, configFile);
        repaired.push(`Restored corrupted config from backup: ${backups[0].name}`);
      }
    }
  }

  // 2. Auto-migrate outdated schema
  if (fs.existsSync(configFile)) {
    try {
      const mig = migrateConfigFile(configFile);
      if (mig.migrated) {
        repaired.push(`Migrated config schema from v${mig.fromVersion} to v${mig.toVersion}`);
      }
    } catch {}
  }

  // 3. Ensure prompt file exists
  let config;
  try {
    config = loadConfig();
    ensurePromptFile(config);
  } catch {}

  // 4. Fix duplicated /v1 in provider baseURL
  if (config?.provider?.baseURL && /\/v1\/v1/i.test(config.provider.baseURL)) {
    const fixed = normalizeProviderURL(config.provider.baseURL);
    config.provider.baseURL = fixed;
    const { safeWriteJsonSync } = require('../config/safe-write');
    safeWriteJsonSync({ filePath: config.paths.configFile, data: config });
    repaired.push(`Fixed duplicated /v1 in provider baseURL → ${fixed}`);
  }

  // 5. Connect detected environment keys if config key is missing
  if (config && !config.provider.apiKey && config.provider.auth?.type !== 'none') {
    const detected = credentials.detectedCredentials();
    if (detected.length > 0) {
      const best = detected[0];
      io.writeEnvValue(config.provider.apiKeyEnv || 'PROVIDER_API_KEY', process.env[best.envVar]);
      repaired.push(`Linked detected environment key from ${best.envVar}`);
    }
  }

  // 6. Repair / configure detected clients
  const clientStatuses = registry.statusAll();
  for (const clientStatus of clientStatuses) {
    if (clientStatus.found && !clientStatus.configured) {
      try {
        const client = registry.getClient(clientStatus.id);
        if (client && config) {
          const baseURL = client.defaultBaseURL(config.server);
          client.configure({ baseURL, model: config.provider.model });
          repaired.push(`Configured client ${client.label} to point at ${baseURL}`);
        }
      } catch (err) {
        // Non-fatal
      }
    }
  }

  // Run diagnostics again to see what's left
  const remaining = await diagnose(options);

  return {
    ok: remaining.ok,
    repaired,
    remainingProblems: remaining.problems,
  };
}

module.exports = {
  checkNode,
  checkConfigFile,
  checkPrompt,
  checkCredentials,
  checkClients,
  diagnose,
  repair,
};
