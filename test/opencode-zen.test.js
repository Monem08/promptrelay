'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createApp } = require('../src/server/app');
const { getPreset, listPresets } = require('../src/providers/presets');
const credentials = require('../src/providers/credentials');
const { applyOpenAIReasoning } = require('../src/reasoning');
const { applyPromptPolicy } = require('../src/prompts');

describe('OpenCode Zen & Space Bunny Free integration', () => {
  it('preset defines valid OpenCode Zen configuration', () => {
    const preset = getPreset('opencode-zen');
    assert.ok(preset, 'opencode-zen preset must exist');
    assert.equal(preset.id, 'opencode-zen');
    assert.ok(preset.label.includes('OpenCode Zen'));
    assert.equal(preset.provider.name, 'OpenCode Zen');
    assert.equal(preset.provider.transport, 'openai-compatible');
    assert.equal(preset.provider.baseURL, 'https://opencode.ai/zen/v1');
    assert.equal(preset.provider.model, 'space-bunny-free');
    assert.equal(preset.provider.forceModel, true);
    assert.equal(preset.provider.apiKeyEnv, 'OPENCODE_API_KEY');
    assert.equal(preset.provider.auth?.type, 'bearer');

    assert.deepEqual(preset.reasoning?.supported, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(preset.reasoning?.default, 'high');
    assert.equal(preset.reasoning?.injectDefault, false);

    const presets = listPresets();
    assert.ok(presets.some((p) => p.id === 'opencode-zen'));
  });

  it('credentials manager maps OPENCODE_API_KEY to opencode-zen', () => {
    const prev = process.env.OPENCODE_API_KEY;
    try {
      process.env.OPENCODE_API_KEY = 'zen-test-key-12345';
      const detected = credentials.detectedCredentials();
      const zenCred = detected.find((c) => c.envVar === 'OPENCODE_API_KEY');
      assert.ok(zenCred, 'OPENCODE_API_KEY must be detected');
      assert.equal(zenCred.provider, 'opencode-zen');
      assert.ok(zenCred.label.includes('OpenCode Zen'));
    } finally {
      if (prev !== undefined) process.env.OPENCODE_API_KEY = prev;
      else delete process.env.OPENCODE_API_KEY;
    }
  });

  it('prepends custom prompt before OpenCode original system instructions', () => {
    const customPrompt = 'Custom Space Bunny rules: always use TypeScript.';
    const originalSystem = 'You are OpenCode, an AI coding assistant.';

    const tmpPrompt = path.join(os.tmpdir(), `test-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tmpPrompt, customPrompt, 'utf8');

    const config = {
      paths: { promptFile: tmpPrompt },
      prompt: { mode: 'prepend', file: tmpPrompt },
    };

    const messages = [
      { role: 'system', content: originalSystem },
      { role: 'user', content: 'Write hello world' },
    ];

    const injected = applyPromptPolicy(messages, config);
    assert.equal(injected.length, 3);
    assert.equal(injected[0].role, 'system');
    assert.equal(injected[0].content, customPrompt);
    assert.equal(injected[1].role, 'system');
    assert.equal(injected[1].content, originalSystem);
    assert.equal(injected[2].role, 'user');

    try { fs.unlinkSync(tmpPrompt); } catch {}
  });

  it('replaces system instructions when mode is replace', () => {
    const customPrompt = 'Custom Space Bunny rules only.';
    const tmpPrompt = path.join(os.tmpdir(), `test-prompt-rep-${Date.now()}.txt`);
    fs.writeFileSync(tmpPrompt, customPrompt, 'utf8');

    const config = {
      paths: { promptFile: tmpPrompt },
      prompt: { mode: 'replace', file: tmpPrompt },
    };

    const messages = [
      { role: 'system', content: 'Original OpenCode prompt' },
      { role: 'user', content: 'Fix bug' },
    ];

    const injected = applyPromptPolicy(messages, config);
    assert.equal(injected.length, 2);
    assert.equal(injected[0].role, 'system');
    assert.equal(injected[0].content, customPrompt);
    assert.equal(injected[1].role, 'user');

    try { fs.unlinkSync(tmpPrompt); } catch {}
  });

  it('passes messages through untouched when mode is passthrough', () => {
    const config = {
      prompt: { mode: 'passthrough' },
    };

    const messages = [
      { role: 'system', content: 'Original OpenCode instructions' },
      { role: 'user', content: 'Do something' },
    ];

    const injected = applyPromptPolicy(messages, config);
    assert.deepEqual(injected, messages);
  });

  it('preserves xhigh reasoning effort for OpenAI-compatible OpenCode Zen requests', () => {
    const zenConfig = {
      provider: {
        name: 'OpenCode Zen',
        transport: 'openai-compatible',
        baseURL: 'https://opencode.ai/zen/v1',
      },
      reasoning: {
        supported: ['low', 'medium', 'high', 'xhigh'],
        default: 'high',
        injectDefault: false,
      },
    };

    // Client explicitly requests xhigh
    const reqBody = {
      model: 'space-bunny-free',
      messages: [{ role: 'user', content: 'Solve hard problem' }],
      reasoning_effort: 'xhigh',
    };

    const out = applyOpenAIReasoning(reqBody, zenConfig);
    assert.equal(out.reasoning_effort, 'xhigh', 'xhigh must be preserved without downgrade');

    // Default high is applied if injectDefault is true
    const defaultOut = applyOpenAIReasoning(
      { model: 'space-bunny-free', messages: [{ role: 'user', content: 'Hi' }] },
      { ...zenConfig, reasoning: { ...zenConfig.reasoning, injectDefault: true } },
    );
    assert.equal(defaultOut.reasoning_effort, 'high');
  });
});

describe('OpenCode Zen Gateway HTTP End-to-End', () => {
  let tmpDir;
  let savedConfigEnv;
  let mockUpstreamServer;
  let mockUpstreamPort;
  let receivedUpstreamRequests = [];

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-zen-test-'));
    savedConfigEnv = process.env.PROMPTRELAY_CONFIG;

    // Ephemeral mock upstream server simulating https://opencode.ai/zen/v1
    mockUpstreamServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        receivedUpstreamRequests.push({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: parsed,
        });

        if (parsed?.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":"Space "}}]}\n\n');
          res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Bunny!"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (parsed?.tools) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-tool',
            object: 'chat.completion',
            model: 'space-bunny-free',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"Moon"}' },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          model: 'space-bunny-free',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hello from Space Bunny!' },
            finish_reason: 'stop',
          }],
        }));
      });
    });

    await new Promise((resolve) => mockUpstreamServer.listen(0, '127.0.0.1', resolve));
    mockUpstreamPort = mockUpstreamServer.address().port;
  });

  after(async () => {
    if (savedConfigEnv) process.env.PROMPTRELAY_CONFIG = savedConfigEnv;
    else delete process.env.PROMPTRELAY_CONFIG;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (mockUpstreamServer) {
      await new Promise((r) => mockUpstreamServer.close(r));
    }
  });

  it('allows OpenCode request when promptScopes.opencode is set and global is placeholder (fixes false 503)', async () => {
    const globalPromptPath = path.join(tmpDir, 'system_prompt.txt');
    const opencodePromptPath = path.join(tmpDir, 'system_prompt_opencode.txt');

    // Global has placeholder text
    fs.writeFileSync(globalPromptPath, '<write your system prompt here>\n', 'utf8');
    // OpenCode scope has real prompt
    fs.writeFileSync(opencodePromptPath, 'Specialized OpenCode Instructions\n', 'utf8');

    const configPath = path.join(tmpDir, 'promptrelay.json');
    const testConfig = {
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: globalPromptPath, root: tmpDir },
      prompt: {
        mode: 'prepend',
        file: globalPromptPath,
        placeholder: '<write your system prompt here>',
      },
      promptScopes: {
        opencode: {
          file: opencodePromptPath,
          mode: 'prepend',
        },
      },
      provider: {
        name: 'OpenCode Zen',
        transport: 'openai-compatible',
        baseURL: `http://127.0.0.1:${mockUpstreamPort}/v1`,
        model: 'space-bunny-free',
        forceModel: true,
        auth: { type: 'bearer' },
      },
      reasoning: {
        supported: ['low', 'medium', 'high', 'xhigh'],
        default: 'high',
      },
      logging: { requests: false },
    };

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = configPath;

    const app = createApp();
    const appServer = http.createServer(app);
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    const appPort = appServer.address().port;

    try {
      receivedUpstreamRequests = [];

      // 1. Request from OpenCode client (via User-Agent or x-promptrelay-client)
      const res = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'opencode/1.2.3',
        },
        body: JSON.stringify({
          model: 'space-bunny-free',
          messages: [
            { role: 'system', content: 'Original OpenCode agent instruction' },
            { role: 'user', content: 'Ping' },
          ],
        }),
      });

      assert.equal(res.status, 200, 'OpenCode request should succeed and NOT return 503');
      const data = await res.json();
      assert.equal(data.choices[0].message.content, 'Hello from Space Bunny!');

      // Verify that the upstream received prepended scoped prompt + original instruction
      assert.equal(receivedUpstreamRequests.length, 1);
      const upstreamMessages = receivedUpstreamRequests[0].body.messages;
      assert.equal(upstreamMessages[0].role, 'system');
      assert.ok(upstreamMessages[0].content.includes('Specialized OpenCode Instructions'));
      assert.equal(upstreamMessages[1].role, 'system');
      assert.ok(upstreamMessages[1].content.includes('Original OpenCode agent instruction'));

      // 2. Request from unknown/unconfigured client with placeholder global should return 503
      const unconfiguredRes = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'curl/8.0',
        },
        body: JSON.stringify({
          model: 'space-bunny-free',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      assert.equal(unconfiguredRes.status, 503, 'Unconfigured global client should receive 503');
    } finally {
      await new Promise((r) => appServer.close(r));
    }
  });

  it('streams responses through to client correctly', async () => {
    const promptPath = path.join(tmpDir, 'system_prompt_stream.txt');
    fs.writeFileSync(promptPath, 'Be helpful\n', 'utf8');

    const configPath = path.join(tmpDir, 'promptrelay_stream.json');
    const testConfig = {
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: promptPath, root: tmpDir },
      prompt: {
        mode: 'prepend',
        file: promptPath,
        placeholder: '<write your system prompt here>',
      },
      provider: {
        name: 'OpenCode Zen',
        transport: 'openai-compatible',
        baseURL: `http://127.0.0.1:${mockUpstreamPort}/v1`,
        model: 'space-bunny-free',
        forceModel: true,
        auth: { type: 'bearer' },
      },
      reasoning: { supported: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
      logging: { requests: false },
    };

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = configPath;

    const app = createApp();
    const appServer = http.createServer(app);
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    const appPort = appServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'opencode/1.0.0',
        },
        body: JSON.stringify({
          model: 'space-bunny-free',
          stream: true,
          messages: [{ role: 'user', content: 'Stream test' }],
        }),
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
      const text = await res.text();
      assert.ok(text.includes('Space '));
      assert.ok(text.includes('Bunny!'));
      assert.ok(text.includes('[DONE]'));
    } finally {
      await new Promise((r) => appServer.close(r));
    }
  });

  it('preserves tools and tool calls through the gateway', async () => {
    const promptPath = path.join(tmpDir, 'system_prompt_tools.txt');
    fs.writeFileSync(promptPath, 'Be helpful\n', 'utf8');

    const configPath = path.join(tmpDir, 'promptrelay_tools.json');
    const testConfig = {
      server: { host: '127.0.0.1', port: 4141 },
      paths: { promptFile: promptPath, root: tmpDir },
      prompt: {
        mode: 'prepend',
        file: promptPath,
        placeholder: '<write your system prompt here>',
      },
      provider: {
        name: 'OpenCode Zen',
        transport: 'openai-compatible',
        baseURL: `http://127.0.0.1:${mockUpstreamPort}/v1`,
        model: 'space-bunny-free',
        forceModel: true,
        auth: { type: 'bearer' },
      },
      reasoning: { supported: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
      logging: { requests: false },
    };

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf8');
    process.env.PROMPTRELAY_CONFIG = configPath;

    const app = createApp();
    const appServer = http.createServer(app);
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    const appPort = appServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'opencode/1.0.0',
        },
        body: JSON.stringify({
          model: 'space-bunny-free',
          tools: [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get current weather',
              parameters: { type: 'object', properties: { location: { type: 'string' } } },
            },
          }],
          messages: [{ role: 'user', content: 'Weather on the Moon?' }],
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.choices[0].finish_reason, 'tool_calls');
      const toolCall = data.choices[0].message.tool_calls[0];
      assert.equal(toolCall.function.name, 'get_weather');
      assert.equal(toolCall.function.arguments, '{"location":"Moon"}');
    } finally {
      await new Promise((r) => appServer.close(r));
    }
  });
});
