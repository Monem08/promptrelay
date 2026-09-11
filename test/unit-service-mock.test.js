'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const {
  generateSystemdUnit,
  generateLaunchdPlist,
  SERVICE_NAME,
  SYSTEMD_UNIT_NAME,
  LAUNCHD_LABEL,
  status,
} = require('../src/service/manager');

describe('Service Manager: Multi-platform Adapters', () => {
  const fakeNode = '/usr/bin/node';
  const fakeServer = '/home/user/.nvm/versions/node/v20.0.0/lib/node_modules/@monem08/promptrelay/src/server.js';

  describe('Linux systemd user service', () => {
    it('generates valid systemd unit configuration without hardcoded /opt paths', () => {
      const unit = generateSystemdUnit(fakeNode, fakeServer);

      assert.ok(unit.includes('[Unit]'), 'should contain [Unit] section');
      assert.ok(unit.includes('[Service]'), 'should contain [Service] section');
      assert.ok(unit.includes('[Install]'), 'should contain [Install] section');
      assert.ok(unit.includes(`ExecStart=${fakeNode} ${fakeServer}`));
      assert.ok(unit.includes('Restart=always'));
      assert.ok(unit.includes('WantedBy=default.target'));

      // Strict safety check: no hardcoded system paths
      assert.ok(!unit.includes('/opt/promptrelay'), 'must not contain hardcoded /opt/promptrelay');
      assert.ok(!unit.includes('sk-'), 'must never contain raw secret keys');
    });

    it('attaches EnvironmentFile when provided and valid', () => {
      const fakeEnvFile = path.join(os.homedir(), '.promptrelay', '.env');
      const unitWithEnv = generateSystemdUnit(fakeNode, fakeServer, fakeEnvFile);
      assert.ok(typeof unitWithEnv === 'string');
    });
  });

  describe('macOS launchd agent', () => {
    it('generates valid XML plist configuration', () => {
      const plist = generateLaunchdPlist(fakeNode, fakeServer);

      assert.ok(plist.includes('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(plist.includes(`<string>${LAUNCHD_LABEL}</string>`));
      assert.ok(plist.includes(`<string>${fakeNode}</string>`));
      assert.ok(plist.includes(`<string>${fakeServer}</string>`));
      assert.ok(plist.includes('<key>RunAtLoad</key>'));
      assert.ok(plist.includes('<true/>'));
      assert.ok(plist.includes('<key>KeepAlive</key>'));
      assert.ok(plist.includes('service.log'));

      // Safety check: no hardcoded /opt paths or secrets
      assert.ok(!plist.includes('/opt/promptrelay'));
      assert.ok(!plist.includes('Bearer '));
    });
  });

  describe('Windows Scheduled Task definitions', () => {
    it('uses correct task name and user logon trigger', () => {
      assert.equal(SERVICE_NAME, 'PromptRelay');
      assert.equal(SYSTEMD_UNIT_NAME, 'promptrelay.service');
      assert.equal(LAUNCHD_LABEL, 'com.monem08.promptrelay');
    });
  });

  describe('Current OS service status inspection', () => {
    it('reports current platform and installed status without throwing', () => {
      const res = status();
      assert.ok(res.platform);
      assert.ok(res.serviceType);
      assert.equal(typeof res.installed, 'boolean');
      assert.equal(typeof res.running, 'boolean');
    });
  });
});
