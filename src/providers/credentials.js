'use strict';

/**
 * Provider credential detection.
 *
 * Scans known environment variables for provider credentials without
 * ever printing, logging, or exposing the actual values. Returns only
 * a boolean presence indicator and the environment variable name.
 */

const KNOWN_CREDENTIAL_ENVS = [
  { envVar: 'PROVIDER_API_KEY',       provider: 'generic',    label: 'PromptRelay Provider Key' },
  { envVar: 'OPENROUTER_API_KEY',     provider: 'openrouter', label: 'OpenRouter' },
  { envVar: 'OPENAI_API_KEY',         provider: 'openai',     label: 'OpenAI' },
  { envVar: 'ANTHROPIC_API_KEY',      provider: 'anthropic',  label: 'Anthropic' },
  { envVar: 'OLLAMA_API_KEY',         provider: 'ollama',     label: 'Ollama' },
  { envVar: 'GOOGLE_API_KEY',         provider: 'google',     label: 'Google AI' },
  { envVar: 'GEMINI_API_KEY',         provider: 'google',     label: 'Gemini' },
  { envVar: 'TOGETHER_API_KEY',       provider: 'together',   label: 'Together AI' },
  { envVar: 'GROQ_API_KEY',           provider: 'groq',       label: 'Groq' },
  { envVar: 'MISTRAL_API_KEY',        provider: 'mistral',    label: 'Mistral' },
  { envVar: 'DEEPSEEK_API_KEY',       provider: 'deepseek',   label: 'DeepSeek' },
  { envVar: 'FIREWORKS_API_KEY',      provider: 'fireworks',  label: 'Fireworks' },
  { envVar: 'PERPLEXITY_API_KEY',     provider: 'perplexity', label: 'Perplexity' },
  { envVar: 'COHERE_API_KEY',         provider: 'cohere',     label: 'Cohere' },
  { envVar: 'XAI_API_KEY',            provider: 'xai',        label: 'xAI' },
  { envVar: 'AZURE_OPENAI_API_KEY',   provider: 'azure',      label: 'Azure OpenAI' },
];

/**
 * Detect which provider credentials are present in the environment.
 * Never exposes the actual values.
 *
 * @returns {Array<{ envVar: string, provider: string, label: string, present: boolean }>}
 */
function detectCredentials() {
  return KNOWN_CREDENTIAL_ENVS.map((entry) => ({
    ...entry,
    present: Boolean(process.env[entry.envVar] && process.env[entry.envVar].trim()),
  }));
}

/**
 * Return only detected (present) credentials.
 */
function detectedCredentials() {
  return detectCredentials().filter((c) => c.present);
}

/**
 * Check if a specific env var has a credential.
 */
function hasCredential(envVar) {
  return Boolean(process.env[envVar] && process.env[envVar].trim());
}

/**
 * Match detected credentials to provider presets.
 * @returns {Array<{ preset: string, envVar: string, label: string }>}
 */
function matchCredentialsToPresets() {
  const { listPresets } = require('./presets');
  const presets = listPresets();
  const detected = detectedCredentials();
  const matches = [];

  for (const cred of detected) {
    for (const preset of presets) {
      // Match by provider name similarity
      if (cred.provider === preset.id ||
          (cred.provider === 'generic' && preset.id === 'openrouter') ||
          (cred.provider === 'openai' && preset.id === 'custom-openai')) {
        matches.push({ preset: preset.id, envVar: cred.envVar, label: cred.label });
      }
    }
  }
  return matches;
}

module.exports = {
  KNOWN_CREDENTIAL_ENVS,
  detectCredentials,
  detectedCredentials,
  hasCredential,
  matchCredentialsToPresets,
};
