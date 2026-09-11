'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_VERSION } = require('./schema');

/**
 * Config migration system.
 *
 * Migrations are keyed by the version they upgrade *from*. Each migration takes
 * a config object and returns the upgraded object with a bumped `version`.
 * Unversioned legacy configs are treated as version 1.
 */

const MIGRATIONS = {
  // 1 -> 2: introduce version field, providers registry, retry & fallback blocks,
  // reasoning.auto. This is additive and preserves all existing behavior.
  1: (config) => {
    const next = { ...config };
    next.version = 2;

    if (!next.providers || typeof next.providers !== 'object') {
      next.providers = {};
    }

    if (!next.reasoning || typeof next.reasoning !== 'object') {
      next.reasoning = { default: 'low', injectDefault: false, auto: false };
    } else if (next.reasoning.auto === undefined) {
      next.reasoning.auto = false;
    }

    if (!next.retry) {
      next.retry = {
        enabled: true,
        maxRetries: 2,
        baseDelayMs: 500,
        maxDelayMs: 8000,
        retryableStatus: [429, 502, 503, 504],
      };
    }

    if (!next.fallback) {
      next.fallback = { enabled: false, providers: [] };
    }

    return next;
  },

  // 2 -> 3: add routing, automation, prompt scopes, security, body limit, logging mode.
  // Add 408 to retryable status. All additive — preserves existing behavior.
  2: (config) => {
    const next = { ...config };
    next.version = 3;

    // Add routing defaults
    if (!next.routing || typeof next.routing !== 'object') {
      next.routing = {
        profile: 'balanced',
        clients: {},
        clientPreferences: {},
        disabledProviders: [],
        disabledModels: [],
        timeoutMs: 60000,
      };
    }

    // Add prompt scopes
    if (!next.promptScopes || typeof next.promptScopes !== 'object') {
      next.promptScopes = {};
    }

    // Add automation defaults
    if (!next.automation || typeof next.automation !== 'object') {
      next.automation = {
        modelRefresh: { enabled: false, intervalMinutes: 60 },
        healthCheck: { enabled: false, intervalMinutes: 15 },
        clientDetection: { enabled: false, intervalMinutes: 30 },
        configSync: { enabled: false, intervalMinutes: 30 },
      };
    }

    // Add security defaults
    if (!next.security || typeof next.security !== 'object') {
      next.security = {
        dashboardToken: '',
        gatewayAuth: { enabled: false, token: '' },
      };
    }

    // Add body limit to server
    if (next.server && !next.server.bodyLimitBytes) {
      next.server.bodyLimitBytes = 2 * 1024 * 1024;
    }

    // Upgrade logging to include mode
    if (next.logging && !next.logging.mode) {
      next.logging.mode = 'metadata';
    }

    // Add 408 to retryable status if not present
    if (next.retry && Array.isArray(next.retry.retryableStatus) && !next.retry.retryableStatus.includes(408)) {
      next.retry.retryableStatus = [408, ...next.retry.retryableStatus];
    }

    return next;
  },
};

/**
 * Detect the on-disk version of a raw config object.
 * @param {object} config
 * @returns {number}
 */
function detectVersion(config) {
  const v = Number(config && config.version);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Create a timestamped backup of a config file before migrating/overwriting it.
 * @param {string} file
 * @returns {string|null} the backup path, or null if there was nothing to back up
 */
function backupConfigFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const dir = path.dirname(file);
  const base = path.basename(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dir, 'backups');
  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch {
    // Fall back to writing beside the file if backups/ can't be created.
    const beside = path.join(dir, `${base}.${stamp}.bak`);
    fs.copyFileSync(file, beside);
    return beside;
  }
  const backupPath = path.join(backupDir, `${base}.${stamp}.bak`);
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

/**
 * Migrate a raw config object to the current schema version (in memory).
 * @param {object} config
 * @returns {{ config: object, migrated: boolean, fromVersion: number, toVersion: number }}
 */
function migrateConfig(config) {
  let current = { ...(config || {}) };
  const fromVersion = detectVersion(current);
  let version = fromVersion;
  let migrated = false;

  while (version < CONFIG_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      // No migration path defined; stamp to current to avoid loops.
      current.version = CONFIG_VERSION;
      version = CONFIG_VERSION;
      migrated = true;
      break;
    }
    current = migration(current);
    version = detectVersion(current);
    migrated = true;
  }

  return { config: current, migrated, fromVersion, toVersion: CONFIG_VERSION };
}

/**
 * Migrate a config file on disk, creating a backup first when changes occur.
 * Uses the safe-write layer for atomic writes with automatic backup.
 *
 * @param {string} file
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - If true, report what would change without writing
 * @returns {{ migrated: boolean, backupPath: string|null, fromVersion: number, toVersion: number, dryRun: boolean }}
 */
function migrateConfigFile(file, options = {}) {
  const { dryRun = false } = options;

  if (!file || !fs.existsSync(file)) {
    return { migrated: false, backupPath: null, fromVersion: 0, toVersion: CONFIG_VERSION, dryRun };
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const { config, migrated, fromVersion, toVersion } = migrateConfig(raw);

  if (!migrated) {
    return { migrated: false, backupPath: null, fromVersion, toVersion, dryRun };
  }

  if (dryRun) {
    return { migrated: true, backupPath: null, fromVersion, toVersion, dryRun: true, changes: config };
  }

  // Use the safe-write layer for atomic backup + write.
  const { safeWriteJsonSync } = require('./safe-write');
  const result = safeWriteJsonSync(file, config);
  if (!result.ok) {
    throw new Error(`Migration write failed: ${result.error}`);
  }

  return { migrated: true, backupPath: result.backupPath, fromVersion, toVersion, dryRun: false };
}

module.exports = {
  MIGRATIONS,
  detectVersion,
  backupConfigFile,
  migrateConfig,
  migrateConfigFile,
};
