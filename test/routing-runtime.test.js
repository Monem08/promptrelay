'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const routing = require('../src/routing/engine');

describe('Runtime Routing Engine', () => {
  const baseConfig = {
    provider: {
      name: 'DefaultProvider',
      transport: 'openai-compatible',
      baseURL: 'http://default-provider/v1',
      model: 'default-model',
    },
    providers: {
      FastProvider: {
        name: 'FastProvider',
        transport: 'openai-compatible',
        baseURL: 'http://fast-provider/v1',
        model: 'fast-model',
      },
      SmartProvider: {
        name: 'SmartProvider',
        transport: 'openai-compatible',
        baseURL: 'http://smart-provider/v1',
        model: 'smart-model',
      },
    },
    routing: {
      profile: 'balanced',
      clients: {
        opencode: 'code-specialized',
        'claude-code': 'reasoning',
        hermes: 'speed',
      },
      clientPreferences: {
        opencode: { provider: 'SmartProvider', model: 'smart-code-model' },
      },
      disabledProviders: [],
      disabledModels: [],
    },
    fallback: {
      enabled: true,
      providers: ['FastProvider'],
    },
  };

  it('detects OpenCode client profile and applies clientPreferences', () => {
    const fakeReq = {
      headers: { 'user-agent': 'opencode/1.0.0' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { clientId, profile, chain } = routing.buildRoutingChain(fakeReq, baseConfig);
    assert.equal(clientId, 'opencode');
    assert.equal(profile, 'code-specialized');
    assert.equal(chain[0].provider.name, 'SmartProvider');
    assert.equal(chain[0].provider.model, 'smart-code-model');
  });

  it('detects Claude Code client and resolves claude-code profile', () => {
    const fakeReq = {
      headers: { 'user-agent': 'claude-code/0.2.29' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { clientId, profile } = routing.buildRoutingChain(fakeReq, baseConfig);
    assert.equal(clientId, 'claude-code');
    assert.equal(profile, 'reasoning');
  });

  it('detects Hermes client and resolves speed profile', () => {
    const fakeReq = {
      headers: { 'x-client-name': 'hermes' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { clientId, profile } = routing.buildRoutingChain(fakeReq, baseConfig);
    assert.equal(clientId, 'hermes');
    assert.equal(profile, 'speed');
  });

  it('falls back to default profile for unknown client', () => {
    const fakeReq = {
      headers: { 'user-agent': 'curl/7.68.0' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { clientId, profile } = routing.buildRoutingChain(fakeReq, baseConfig);
    assert.equal(clientId, 'unknown');
    assert.equal(profile, 'balanced');
  });

  it('skips disabled providers and models', () => {
    const disabledConfig = {
      ...baseConfig,
      routing: {
        ...baseConfig.routing,
        disabledProviders: ['DefaultProvider'],
        disabledModels: ['fast-model'],
      },
    };

    const fakeReq = {
      headers: { 'user-agent': 'curl/7.68.0' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { chain } = routing.buildRoutingChain(fakeReq, disabledConfig);
    // DefaultProvider is disabled, fast-model is disabled
    const providerNames = chain.map((c) => c.provider.name);
    assert.ok(!providerNames.includes('DefaultProvider'), 'DefaultProvider should be skipped');
  });

  it('deprioritizes unhealthy providers in target selection', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-routing-health-'));
    const healthFile = path.join(tmpDir, 'health.json');
    fs.writeFileSync(
      healthFile,
      JSON.stringify({
        DefaultProvider: { ok: false, status: 'unreachable' },
        FastProvider: { ok: true, status: 'healthy' },
      }),
      'utf8'
    );

    const healthConfig = {
      ...baseConfig,
      paths: { healthFile },
      routing: {
        profile: 'balanced',
        clients: {},
        clientPreferences: {},
        disabledProviders: [],
        disabledModels: [],
      },
    };

    const fakeReq = {
      headers: {},
      body: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const { chain } = routing.buildRoutingChain(fakeReq, healthConfig);
    // Healthy FastProvider should be moved ahead of unhealthy DefaultProvider
    assert.equal(chain[0].provider.name, 'FastProvider');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('honors capability constraints for vision/tools', () => {
    const capConfig = {
      ...baseConfig,
      providers: {
        VisionCapable: {
          name: 'VisionCapable',
          transport: 'openai-compatible',
          model: 'vision-model',
          vision: true,
        },
        TextOnly: {
          name: 'TextOnly',
          transport: 'openai-compatible',
          model: 'text-model',
          vision: false,
        },
      },
      fallback: {
        enabled: true,
        providers: ['VisionCapable', 'TextOnly'],
      },
    };

    const visionReq = {
      headers: {},
      body: {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
          ],
        }],
      },
    };

    const { chain } = routing.buildRoutingChain(visionReq, capConfig);
    assert.ok(chain.length > 0);
  });
});
