'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.resolve(
  process.env.PROMPTRELAY_HOME || path.join(os.homedir(), '.promptrelay'),
);
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(HOME, 'promptrelay.json');
const PROMPT_FILE = path.join(HOME, 'system_prompt.txt');
const ENV_FILE = path.join(HOME, '.env');
const PID_FILE = path.join(HOME, 'promptrelay.pid');
const PLACEHOLDER = '{Paste your instructions here}';

function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
  try {
    fs.chmodSync(HOME, 0o700);
  } catch {}
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonIfExists(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function copyIfMissing(source, target) {
  if (fs.existsSync(target)) return false;
  fs.copyFileSync(source, target);
  return true;
}

// --- .env helpers -----------------------------------------------------------

function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
}

function writeEnvValue(key, value) {
  ensureHome();
  const current = readEnvLines();
  const lines = current.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith(`${key}=`);
  });
  lines.push(`${key}=${JSON.stringify(String(value || ''))}`);
  fs.writeFileSync(ENV_FILE, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {}
}

function removeEnvValue(key) {
  if (!fs.existsSync(ENV_FILE)) return false;
  const current = readEnvLines();
  const remaining = current.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith(`${key}=`);
  });
  fs.writeFileSync(ENV_FILE, `${remaining.filter(Boolean).join('\n')}\n`, 'utf8');
  return current.length !== remaining.length;
}

function listEnvKeys() {
  return readEnvLines()
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim())
    .filter(Boolean);
}

module.exports = {
  HOME,
  PACKAGE_ROOT,
  CONFIG_FILE,
  PROMPT_FILE,
  ENV_FILE,
  PID_FILE,
  PLACEHOLDER,
  ensureHome,
  writeJson,
  readJsonIfExists,
  copyIfMissing,
  writeEnvValue,
  removeEnvValue,
  listEnvKeys,
};
