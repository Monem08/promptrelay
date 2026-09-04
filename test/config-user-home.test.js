const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const configModule = path.resolve(__dirname, '..', 'src', 'config.js');

test('user config resolves prompt beside config and loads local .env', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-config-'));
  const configFile = path.join(home, 'promptrelay.json');

  fs.writeFileSync(
    configFile,
    JSON.stringify({
      prompt: {
        mode: 'replace',
        file: 'system_prompt.txt',
        placeholder: '{Paste your instructions here}',
      },
      provider: {
        name: 'Custom Test',
        transport: 'openai-compatible',
        baseURL: 'https://example.com/v1',
        model: 'test-model',
        forceModel: true,
        apiKeyEnv: 'PROVIDER_API_KEY',
        auth: { type: 'bearer' },
      },
    }),
    'utf8',
  );

  fs.writeFileSync(path.join(home, 'system_prompt.txt'), 'CUSTOM\n', 'utf8');
  fs.writeFileSync(path.join(home, '.env'), 'PROVIDER_API_KEY="secret-test-key"\n', 'utf8');

  const script = `
    process.env.PROMPTRELAY_CONFIG = ${JSON.stringify(configFile)};
    delete process.env.PROVIDER_API_KEY;
    const { loadConfig } = require(${JSON.stringify(configModule)});
    const config = loadConfig();
    process.stdout.write(JSON.stringify({
      promptFile: config.paths.promptFile,
      envFile: config.paths.envFile,
      key: config.provider.apiKey,
      model: config.provider.model
    }));
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, PROMPTRELAY_CONFIG: configFile, PROVIDER_API_KEY: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.promptFile, path.join(home, 'system_prompt.txt'));
  assert.equal(value.envFile, path.join(home, '.env'));
  assert.equal(value.key, 'secret-test-key');
  assert.equal(value.model, 'test-model');
});
