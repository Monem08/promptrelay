'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { AutomationManager } = require('../src/automation/manager');

describe('Automation Manager', () => {
  it('initializes all 7 required background jobs', () => {
    const mgr = new AutomationManager();
    const status = mgr.getStatus();
    const expectedJobs = [
      'modelRefresh',
      'healthCheck',
      'clientDetection',
      'autoRepair',
      'serviceStart',
      'configSync',
      'updateCheck',
    ];

    for (const id of expectedJobs) {
      assert.ok(status[id], `Job ${id} should exist`);
      assert.equal(typeof status[id].enabled, 'boolean');
      assert.equal(typeof status[id].running, 'boolean');
      assert.equal(status[id].running, false);
      assert.equal(typeof status[id].intervalMinutes, 'number');
    }
  });

  it('supports custom intervals on construction', () => {
    const mgr = new AutomationManager({
      intervals: {
        healthCheck: 5 * 60 * 1000,
        modelRefresh: 120 * 60 * 1000,
      },
    });
    const status = mgr.getStatus();
    assert.equal(status.healthCheck.intervalMinutes, 5);
    assert.equal(status.modelRefresh.intervalMinutes, 120);
  });

  it('runs jobs via runNow and tracks structured results', async () => {
    let called = false;
    const mgr = new AutomationManager();
    mgr.registerJob({
      id: 'testJob',
      label: 'Test Job',
      handler: async () => {
        called = true;
        return { items: 42 };
      },
    });

    const runResult = await mgr.runNow('testJob');
    assert.equal(runResult.ok, true);
    assert.equal(called, true);
    assert.equal(runResult.result.items, 42);
    assert.equal(typeof runResult.durationMs, 'number');

    const status = mgr.getStatus().testJob;
    assert.ok(status.lastRun, 'lastRun should be set');
    assert.ok(status.lastSuccess, 'lastSuccess should be set');
    assert.equal(status.lastError, null);
    assert.equal(status.hasResult, true);
  });

  it('captures job errors truthfully', async () => {
    const mgr = new AutomationManager();
    mgr.registerJob({
      id: 'failingJob',
      label: 'Failing Job',
      handler: async () => {
        throw new Error('Connection refused to upstream');
      },
    });

    const result = await mgr.runNow('failingJob');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Connection refused to upstream');

    const status = mgr.getStatus().failingJob;
    assert.equal(status.lastError, 'Connection refused to upstream');
    assert.ok(status.lastRun);
    assert.equal(status.lastSuccess, null);
  });

  it('enforces non-overlapping execution (mutex lock)', async () => {
    const mgr = new AutomationManager();
    let release;
    const blocker = new Promise((resolve) => { release = resolve; });

    mgr.registerJob({
      id: 'slowJob',
      label: 'Slow Job',
      handler: async () => {
        await blocker;
        return { done: true };
      },
    });

    // Start first run asynchronously
    const firstRunPromise = mgr.runJob('slowJob');

    // Attempt second run while first is in-flight
    const secondRun = await mgr.runJob('slowJob');
    assert.equal(secondRun.skipped, true);
    assert.ok(secondRun.error.includes('non-overlapping'));

    // Release and wait for first run to complete
    release();
    const firstRun = await firstRunPromise;
    assert.equal(firstRun.ok, true);
    assert.equal(firstRun.result.done, true);
  });

  it('starts and stops timers cleanly without leaking handles', () => {
    const mgr = new AutomationManager();
    const config = {
      automation: {
        modelRefresh: { enabled: true, intervalMinutes: 10 },
        healthCheck: { enabled: true, intervalMinutes: 5 },
      },
    };

    mgr.start(config);
    const statusBefore = mgr.getStatus();
    assert.equal(statusBefore.modelRefresh.enabled, true);
    assert.equal(statusBefore.healthCheck.enabled, true);
    assert.ok(statusBefore.modelRefresh.nextRun, 'should have nextRun scheduled');

    // Stop shuts down all timers cleanly
    mgr.stop();
    for (const job of mgr.jobs.values()) {
      assert.equal(job.timer, null, 'Timer should be cleared');
    }
  });

  it('dynamically updates configuration at runtime', () => {
    const mgr = new AutomationManager();
    mgr.start({ automation: { autoRefreshModels: false } });

    assert.equal(mgr.getStatus().modelRefresh.enabled, false);

    // Dynamic enable via updateConfig
    mgr.updateConfig({ automation: { autoRefreshModels: true } });
    assert.equal(mgr.getStatus().modelRefresh.enabled, true);
    assert.ok(mgr.getStatus().modelRefresh.nextRun);

    // Dynamic disable via setJobEnabled
    mgr.setJobEnabled('modelRefresh', false);
    assert.equal(mgr.getStatus().modelRefresh.enabled, false);
    assert.equal(mgr.getStatus().modelRefresh.nextRun, null);

    mgr.stop();
  });

  it('executes job on interval tick using fake timers', async () => {
    let tickCount = 0;
    const mgr = new AutomationManager();
    mgr.registerJob({
      id: 'ticker',
      label: 'Ticker',
      intervalMs: 25,
      handler: async () => {
        tickCount += 1;
        return { ticks: tickCount };
      },
    });

    mgr.setJobEnabled('ticker', true);

    // Wait for ticks
    await new Promise((resolve) => setTimeout(resolve, 120));

    mgr.stop();
    assert.ok(tickCount >= 1, `Expected at least 1 tick, got ${tickCount}`);
  });
});
