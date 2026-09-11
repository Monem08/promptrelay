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

  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude) — native Messages API',
    transport: 'anthropic-native',
    template: () => ({
      name: 'Anthropic',
      transport: 'anthropic-native',
      baseURL: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      forceModel: true,
      apiKeyEnv: 'PROVIDER_API_KEY',
      auth: { type: 'header', headerName: 'x-api-key' },
      modelsPath: '/v1/models',
      chatPath: '/v1/messages',
      headers: {
        'anthropic-version': '2023-06-01',
      },
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  openai: {
    id: 'openai',
    label: 'OpenAI — GPT-4o / o1 / o3-mini',
    transport: 'openai-compatible',
    template: () => ({
      name: 'OpenAI',
      transport: 'openai-compatible',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      forceModel: true,
      apiKeyEnv: 'OPENAI_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek — coding & reasoning models',
    transport: 'openai-compatible',
    template: () => ({
      name: 'DeepSeek',
      transport: 'openai-compatible',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      forceModel: true,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  groq: {
    id: 'groq',
    label: 'Groq — ultra-low latency inference',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Groq',
      transport: 'openai-compatible',
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      forceModel: true,
      apiKeyEnv: 'GROQ_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  mistral: {
    id: 'mistral',
    label: 'Mistral AI — Codestral & frontier models',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Mistral',
      transport: 'openai-compatible',
      baseURL: 'https://api.mistral.ai/v1',
      model: 'codestral-latest',
      forceModel: true,
      apiKeyEnv: 'MISTRAL_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  gemini: {
    id: 'gemini',
    label: 'Google Gemini — OpenAI-compatible API',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Google Gemini',
      transport: 'openai-compatible',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-2.0-flash',
      forceModel: true,
      apiKeyEnv: 'GEMINI_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  together: {
    id: 'together',
    label: 'Together AI — open source models',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Together AI',
      transport: 'openai-compatible',
      baseURL: 'https://api.together.xyz/v1',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      forceModel: true,
      apiKeyEnv: 'TOGETHER_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  fireworks: {
    id: 'fireworks',
    label: 'Fireworks AI — fast production models',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Fireworks AI',
      transport: 'openai-compatible',
      baseURL: 'https://api.fireworks.ai/inference/v1',
      model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      forceModel: true,
      apiKeyEnv: 'FIREWORKS_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  cerebras: {
    id: 'cerebras',
    label: 'Cerebras — wafer-scale high-speed inference',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Cerebras',
      transport: 'openai-compatible',
      baseURL: 'https://api.cerebras.ai/v1',
      model: 'llama3.3-70b',
      forceModel: true,
      apiKeyEnv: 'CEREBRAS_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  sambanova: {
    id: 'sambanova',
    label: 'SambaNova — SN40L accelerator cloud',
    transport: 'openai-compatible',
    template: () => ({
      name: 'SambaNova',
      transport: 'openai-compatible',
      baseURL: 'https://api.sambanova.ai/v1',
      model: 'Meta-Llama-3.3-70B-Instruct',
      forceModel: true,
      apiKeyEnv: 'SAMBANOVA_API_KEY',
      auth: { type: 'bearer' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
  },

  azure: {
    id: 'azure',
    label: 'Azure OpenAI — enterprise deployment',
    transport: 'openai-compatible',
    template: () => ({
      name: 'Azure OpenAI',
      transport: 'openai-compatible',
      baseURL: 'https://your-resource.openai.azure.com/openai/deployments/your-deployment',
      model: 'gpt-4o',
      forceModel: true,
      apiKeyEnv: 'AZURE_OPENAI_API_KEY',
      auth: { type: 'header', headerName: 'api-key' },
      modelsPath: 'models',
      chatPath: 'chat/completions',
      headers: {},
    }),
    reasoning: { default: 'low', injectDefault: false, auto: false },
    needsKey: true,
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
