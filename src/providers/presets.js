'use strict';

/**
 * Built-in provider presets. Each preset returns a provider config block that
 * matches PromptRelay's schema. Presets are templates: the caller fills in
 * model/baseURL/key as needed.
 */

const PRESETS = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter — easiest / recommended',
    transport: 'openai-compatible',
    template: () => ({
      name: 'OpenRouter',
      transport: 'openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {
        'HTTP-Referer': 'https://github.com/Monem08/promptrelay',
        'X-Title': 'PromptRelay',
      },
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  'ollama-cloud': {
    id: 'ollama-cloud',
    label: 'Ollama Cloud — native fast mode',
    transport: 'ollama-native',
    template: () => ({
      name: 'Ollama Cloud',
      transport: 'ollama-native',
      baseURL: 'https://ollama.com',
      model: '',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: true, auto: false },
    needsKey: true,
  },

  'ollama-local': {
    id: 'ollama-local',
    label: 'Ollama Local — no API key',
    transport: 'ollama-native',
    template: () => ({
      name: 'Ollama Local',
      transport: 'ollama-native',
      baseURL: 'http://127.0.0.1:11434',
      model: '',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'none' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: true, auto: false },
    needsKey: false,
  },

  'custom-openai': {
    id: 'custom-openai',
    label: 'Custom OpenAI-compatible provider',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Custom Provider',
      transport: 'openai-compatible',
      baseURL: '',
      model: '',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  'custom-ollama': {
    id: 'custom-ollama',
    label: 'Custom Ollama-native provider',
    transport: 'ollama-native',
    template: () => ({
      name: 'Custom Ollama',
      transport: 'ollama-native',
      baseURL: 'http://127.0.0.1:11434',
      model: '',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'none' },
      chatPath: '/api/chat',
      modelsPath: '/v1/models',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: true, auto: false },
    needsKey: false,
  },
};

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    transport: p.transport,
    needsKey: p.needsKey,
  }));
}

function getPreset(id) {
  const preset = PRESETS[String(id || '').toLowerCase()];
  if (!preset) return null;
  return {
    id: preset.id,
    label: preset.label,
    transport: preset.transport,
    needsKey: preset.needsKey,
    provider: preset.template(),
    reasoning: { ...preset.reasoning },
  };
}

module.exports = { PRESETS, listPresets, getPreset };
