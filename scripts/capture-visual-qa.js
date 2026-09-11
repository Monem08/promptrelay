'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const QA_DIR = path.join(__dirname, '..', 'docs', 'ui-qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const testDir = path.join(__dirname, '..', 'scratch', 'visual-qa-env');
fs.mkdirSync(testDir, { recursive: true });

const configFile = path.join(testDir, 'promptrelay.json');
fs.writeFileSync(configFile, JSON.stringify({
  version: 2,
  server: { host: '127.0.0.1', port: 4155, verbose: false },
  provider: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.7-sonnet',
    transport: 'openai-compatible',
    apiKeyEnv: 'PROVIDER_API_KEY',
    auth: { type: 'bearer' }
  },
  providers: {
    openrouter: {
      name: 'OpenRouter',
      transport: 'openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.7-sonnet'
    },
    openai: {
      name: 'OpenAI Direct',
      transport: 'openai-compatible',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    },
    ollama: {
      name: 'Ollama Local',
      transport: 'ollama-native',
      baseURL: 'http://127.0.0.1:11434',
      model: 'llama3.3:latest'
    }
  },
  prompt: { mode: 'passthrough' },
  routing: {
    defaultProfile: 'coding',
    clientPreferences: {
      opencode: 'openrouter',
      'claude-code': 'openrouter',
      hermes: 'ollama'
    }
  }
}, null, 2));

process.env.PROMPTRELAY_CONFIG = configFile;
process.env.PORT = '4155';

const { createApp } = require('../src/server/app');
const app = createApp({ configFile });
const server = http.createServer(app);

server.listen(4155, '127.0.0.1', async () => {
  console.log('Visual QA Server listening on http://127.0.0.1:4155');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(testDir, 'chrome-qa-profile')
  ]);

  await new Promise((r) => setTimeout(r, 1600));

  try {
    const verRes = await fetch('http://127.0.0.1:9225/json/list');
    const targets = await verRes.json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let id = 1;
    const pending = new Map();

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    await new Promise((resolve) => { ws.onopen = resolve; });
    console.log('Connected to CDP for Visual QA');

    await send('Runtime.enable');
    await send('Page.enable');

    const captureView = async (urlPath, filename, width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width <= 768
      });
      await send('Page.navigate', { url: `http://127.0.0.1:4155/dashboard/${urlPath}` });
      await new Promise((r) => setTimeout(r, 900));

      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(screenshot.data, 'base64');
      fs.writeFileSync(path.join(QA_DIR, filename), buf);
      console.log(`Captured ${filename} (${width}x${height})`);
    };

    // 1. Overview Desktop (1440x900)
    await captureView('#/overview', 'overview-desktop.png', 1440, 900);

    // 2. Clients Desktop (1440x900)
    await captureView('#/clients', 'clients-desktop.png', 1440, 900);

    // 3. Clients Mobile (390x844)
    await captureView('#/clients', 'clients-mobile.png', 390, 844);

    // 4. Providers Desktop (1440x900)
    await captureView('#/providers', 'providers-desktop.png', 1440, 900);

    // 5. Add Provider Step 1 (1024x768)
    await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:4155/dashboard/#/providers' });
    await new Promise((r) => setTimeout(r, 800));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Provider'));
          if (btn) btn.click();
        })()
      `
    });
    await new Promise((r) => setTimeout(r, 600));
    let ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(QA_DIR, 'add-provider-step1.png'), Buffer.from(ss.data, 'base64'));
    console.log('Captured add-provider-step1.png');

    // 6. Add Provider Step 5 Testing (1024x768)
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const choice = document.querySelector('.choice');
          if (choice) choice.click();
        })()
      `
    });
    await new Promise((r) => setTimeout(r, 200));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
          if (btn) btn.click();
        })()
      `
    });
    // Now on step 2 (Auth). Click continue
    await new Promise((r) => setTimeout(r, 300));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
          if (btn) btn.click();
        })()
      `
    });
    // Now on step 3 (Connection). Click continue
    await new Promise((r) => setTimeout(r, 300));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
          if (btn) btn.click();
        })()
      `
    });
    // Now on step 4 (Models). Fill model and click continue
    await new Promise((r) => setTimeout(r, 300));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const inp = document.querySelector('input.input.mono');
          if (inp) { inp.value = 'gpt-4o'; inp.dispatchEvent(new Event('input')); }
        })()
      `
    });
    await new Promise((r) => setTimeout(r, 200));
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
          if (btn) btn.click();
        })()
      `
    });
    // Now on step 5 (Test)
    await new Promise((r) => setTimeout(r, 400));
    ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(QA_DIR, 'add-provider-step5-test.png'), Buffer.from(ss.data, 'base64'));
    console.log('Captured add-provider-step5-test.png');

    // 7. Add Provider Step 6 Review (1024x768)
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Skip') || b.textContent.includes('Continue'));
          if (btn) btn.click();
        })()
      `
    });
    await new Promise((r) => setTimeout(r, 400));
    ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(QA_DIR, 'add-provider-step6-review.png'), Buffer.from(ss.data, 'base64'));
    console.log('Captured add-provider-step6-review.png');

    // Close modal
    await send('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));` });
    await new Promise((r) => setTimeout(r, 300));

    // 8. Router Desktop (1440x900)
    await captureView('#/router', 'router-desktop.png', 1440, 900);

    // 9. Prompt Studio Desktop (1440x900)
    await captureView('#/prompts', 'prompts-desktop.png', 1440, 900);

    // 10. Settings Desktop (1440x900)
    await captureView('#/settings', 'settings-desktop.png', 1440, 900);

    // 11. Requests Desktop (1440x900)
    await captureView('#/requests', 'requests-desktop.png', 1440, 900);

    ws.close();
    console.log('All screenshots successfully captured into', QA_DIR);
  } catch (err) {
    console.error('Visual QA error:', err);
  } finally {
    chromeProc.kill();
    server.close();
    process.exit(0);
  }
});
