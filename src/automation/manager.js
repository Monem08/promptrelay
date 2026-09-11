'use strict';

/**
 * PromptRelay Automation Manager.
 *
 * Drives real background behaviors for every dashboard automation toggle:
 *  1. modelRefresh       (autoRefreshModels)       - Periodically refresh model cache
 *  2. healthCheck        (autoHealthCheck)        - Background provider health check
 *  3. clientDetection    (autoDetectClientConfig) - Detect client configurations
 *  4. autoRepair         (autoRepairSafe)         - Safe diagnostics auto-repair
 *  5. serviceStart       (autoStart)              - Ensure background service is running
 *  6. configSync         (autoSyncClients)        - Keep client wiring synced with active model
 *  7. updateCheck        (autoRefreshLifecycle)   - Check version/lifecycle metadata
 *
 * Guarantees:
 *  - Mutex lock per job (no overlapping execution)
 *  - Cancellation during gateway shutdown
 *  - Manual Run Now
 *  - Accurate last-run, last-success, next-run timestamps
 *  - Last error tracking and structured job results
 *  - Dynamic enable/disable and interval configuration at runtime
 */

const fs = require('fs');

const DEFAULT_INTERVALS_MS = {
  modelRefresh: 60 * 60 * 1000,    // 60 minutes
  healthCheck: 15 * 60 * 1000,     // 15 minutes
  clientDetection: 30 * 60 * 1000, // 30 minutes
  autoRepair: 30 * 60 * 1000,      // 30 minutes
  serviceStart: 10 * 60 * 1000,    // 10 minutes
  configSync: 30 * 60 * 1000,      // 30 minutes
  updateCheck: 24 * 60 * 60 * 1000,// 24 hours
};

const TOGGLE_TO_JOB = {
  autoRefreshModels: 'modelRefresh',
  autoHealthCheck: 'healthCheck',
  autoDetectClientConfig: 'clientDetection',
  autoRepairSafe: 'autoRepair',
  autoStart: 'serviceStart',
  autoSyncClients: 'configSync',
  autoRefreshLifecycle: 'updateCheck',
};

const JOB_TO_TOGGLE = Object.fromEntries(
  Object.entries(TOGGLE_TO_JOB).map(([toggle, job]) => [job, toggle])
);

class AutomationManager {
  constructor(options = {}) {
    this.customIntervals = options.intervals || {};
    this.logger = options.logger || console;
    this.config = options.config || null;
    this.jobs = new Map();
    this._initJobs();
  }

  _initJobs() {
    const jobDefs = [
      {
        id: 'modelRefresh',
        toggleKey: 'autoRefreshModels',
        label: 'Model Cache Refresh',
        handler: async (config) => {
          const models = require('../models');
          return models.discoverModels(config, { refresh: true });
        },
      },
      {
        id: 'healthCheck',
        toggleKey: 'autoHealthCheck',
        label: 'Provider Health Check',
        handler: async (config) => {
          const providers = require('../providers');
          return providers.health.safeCheck(config);
        },
      },
      {
        id: 'clientDetection',
        toggleKey: 'autoDetectClientConfig',
        label: 'Client Detection',
        handler: async () => {
          const registry = require('../clients/registry');
          return registry.detectAll();
        },
      },
      {
        id: 'autoRepair',
        toggleKey: 'autoRepairSafe',
        label: 'Safe Auto-Repair',
        handler: async (config) => {
          const doctor = require('../doctor');
          return doctor.runDiagnostics(config, { fix: true });
        },
      },
      {
        id: 'serviceStart',
        toggleKey: 'autoStart',
        label: 'Auto Service Start',
        handler: async () => {
          const service = require('../service/manager');
          const s = service.status();
          if (s.installed && !s.running) {
            return service.start();
          }
          return { running: s.running, installed: s.installed };
        },
      },
      {
        id: 'configSync',
        toggleKey: 'autoSyncClients',
        label: 'Client Config Sync',
        handler: async (config) => {
          const registry = require('../clients/registry');
          const detected = registry.detectAll().filter((c) => c.installed || c.found);
          const synced = [];
          for (const c of detected) {
            if (c.configured) {
              const adapter = registry.getClient(c.id);
              if (adapter && typeof adapter.configure === 'function') {
                const baseURL = adapter.defaultBaseURL(config.server);
                const res = adapter.configure({ baseURL, model: config.provider.model });
                synced.push({ id: c.id, ...res });
              }
            }
          }
          return { syncedCount: synced.length, clients: synced };
        },
      },
      {
        id: 'updateCheck',
        toggleKey: 'autoRefreshLifecycle',
        label: 'Lifecycle & Update Check',
        handler: async () => {
          const version = require('../../package.json').version;
          return { currentVersion: version, checkedAt: new Date().toISOString() };
        },
      },
    ];

    for (const def of jobDefs) {
      const intervalMs = this.customIntervals[def.id] || DEFAULT_INTERVALS_MS[def.id];
      this.jobs.set(def.id, {
        ...def,
        intervalMs,
        enabled: false,
        running: false,
        timer: null,
        lastRun: null,
        lastSuccess: null,
        nextRun: null,
        lastError: null,
        lastResult: null,
      });
    }
  }

  /**
   * Start the scheduler with the given config.
   */
  start(config) {
    this.config = config || this.config;
    this.updateConfig(this.config);
  }

  /**
   * Stop all running timers (clean shutdown).
   */
  stop() {
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      job.nextRun = null;
    }
  }

  /**
   * Register a custom or dynamic job definition.
   */
  registerJob(jobDef) {
    const id = jobDef.id;
    const intervalMs = jobDef.intervalMs || this.customIntervals[id] || (30 * 60 * 1000);
    this.jobs.set(id, {
      ...jobDef,
      toggleKey: jobDef.toggleKey || id,
      intervalMs,
      enabled: Boolean(jobDef.enabled),
      running: false,
      timer: null,
      lastRun: null,
      lastSuccess: null,
      nextRun: null,
      lastError: null,
      lastResult: null,
    });
    if (jobDef.enabled) {
      this._schedule(id, intervalMs);
    }
  }

  /**
   * Update configuration at runtime (enable/disable jobs, adjust intervals).
   */
  updateConfig(config) {
    this.config = config || this.config;
    const autoSettings = this.config?.automation || {};

    for (const [id, job] of this.jobs.entries()) {
      let toggleValue = false;
      if (typeof autoSettings[id] === 'boolean') {
        toggleValue = autoSettings[id];
      } else if (autoSettings[id] && typeof autoSettings[id].enabled === 'boolean') {
        toggleValue = autoSettings[id].enabled;
      } else if (typeof autoSettings[job.toggleKey] === 'boolean') {
        toggleValue = autoSettings[job.toggleKey];
      }

      const configIntervalMin = autoSettings[id]?.intervalMinutes;
      if (typeof configIntervalMin === 'number' && configIntervalMin > 0) {
        job.intervalMs = configIntervalMin * 60 * 1000;
      } else if (this.customIntervals[id]) {
        job.intervalMs = this.customIntervals[id];
      }

      const wasEnabled = job.enabled;
      job.enabled = toggleValue;

      if (job.enabled && !wasEnabled) {
        this._schedule(id, job.intervalMs);
      } else if (!job.enabled && wasEnabled) {
        if (job.timer) {
          clearTimeout(job.timer);
          job.timer = null;
        }
        job.nextRun = null;
      }
    }
  }

  /**
   * Enable or disable a job directly at runtime.
   */
  setEnabled(jobOrToggle, enabled) {
    const jobId = TOGGLE_TO_JOB[jobOrToggle] || jobOrToggle;
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.enabled = Boolean(enabled);
    if (job.enabled) {
      this._schedule(jobId, job.intervalMs);
    } else {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      job.nextRun = null;
    }
    return true;
  }

  setJobEnabled(jobOrToggle, enabled) {
    return this.setEnabled(jobOrToggle, enabled);
  }

  _schedule(jobId, delayMs) {
    const job = this.jobs.get(jobId);
    if (!job || !job.enabled) return;

    if (job.timer) {
      clearTimeout(job.timer);
    }

    job.nextRun = new Date(Date.now() + delayMs).toISOString();
    job.timer = setTimeout(async () => {
      job.timer = null;
      await this.runJob(jobId);
      if (job.enabled) {
        this._schedule(jobId, job.intervalMs);
      }
    }, delayMs);

    if (typeof job.timer.unref === 'function') {
      job.timer.unref();
    }
  }

  /**
   * Execute a single job (enforcing non-overlapping execution).
   * @param {string} jobId
   * @returns {Promise<{ id: string, ok: boolean, durationMs: number, error: string|null, result: any }>}
   */
  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { id: jobId, ok: false, durationMs: 0, error: `Unknown job ${jobId}`, result: null };
    }

    // Mutex: prevent overlapping execution
    if (job.running) {
      return {
        id: jobId,
        ok: false,
        durationMs: 0,
        error: 'Job is already running (non-overlapping execution enforced)',
        result: null,
        skipped: true,
      };
    }

    job.running = true;
    const startedAt = Date.now();
    job.lastRun = new Date(startedAt).toISOString();

    try {
      const config = this.config || (require('../config').loadConfig());
      const result = await job.handler(config);
      const durationMs = Date.now() - startedAt;

      job.running = false;
      job.lastSuccess = new Date().toISOString();
      job.lastError = null;
      job.lastResult = result;

      return { id: jobId, ok: true, durationMs, error: null, result };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      job.running = false;
      job.lastError = err.message;

      return { id: jobId, ok: false, durationMs, error: err.message, result: null };
    }
  }

  /**
   * Manual Run Now execution.
   */
  async runNow(jobOrToggle) {
    const jobId = TOGGLE_TO_JOB[jobOrToggle] || jobOrToggle;
    return this.runJob(jobId);
  }

  /**
   * Get structured status of all automation jobs.
   */
  getStatus() {
    const status = {};
    for (const [id, job] of this.jobs.entries()) {
      status[id] = {
        id,
        toggleKey: job.toggleKey,
        label: job.label,
        enabled: job.enabled,
        running: job.running,
        intervalMinutes: Math.round(job.intervalMs / (60 * 1000)),
        intervalMs: job.intervalMs,
        lastRun: job.lastRun,
        lastSuccess: job.lastSuccess,
        nextRun: job.nextRun,
        lastError: job.lastError,
        hasResult: job.lastResult !== null,
      };
    }
    return status;
  }
}

// Singleton instance for server runtime
let defaultManager = null;

function getAutomationManager(options) {
  if (!defaultManager || options) {
    defaultManager = new AutomationManager(options);
  }
  return defaultManager;
}

module.exports = {
  AutomationManager,
  getAutomationManager,
  DEFAULT_INTERVALS_MS,
  TOGGLE_TO_JOB,
  JOB_TO_TOGGLE,
};
