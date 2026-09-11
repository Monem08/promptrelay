'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Shared filesystem helpers for client adapters. Every mutation of a client's
 * config file goes through backupFile first, so a user's existing configuration
 * can always be restored.
 */

function backupFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

function readJsonIfExists(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Set KEY=value in a dotenv-style file, preserving other lines. Never logs. */
function upsertEnvValue(file, key, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const kept = existing.filter((line) => {
    const t = line.trim();
    return t && !t.startsWith(`${key}=`) && !t.startsWith(`export ${key}=`);
  });
  kept.push(`${key}=${value}`);
  fs.writeFileSync(file, `${kept.filter(Boolean).join('\n')}\n`, 'utf8');
  try { fs.chmodSync(file, 0o600); } catch { /* noop */ }
}

function removeEnvValue(file, key) {
  if (!fs.existsSync(file)) return false;
  const existing = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const kept = existing.filter((line) => {
    const t = line.trim();
    return t && !t.startsWith(`${key}=`) && !t.startsWith(`export ${key}=`);
  });
  fs.writeFileSync(file, `${kept.filter(Boolean).join('\n')}\n`, 'utf8');
  return kept.length !== existing.filter(Boolean).length;
}

const { execFileSync } = require('child_process');

function findExecutable(names) {
  const exes = Array.isArray(names) ? names : [names];
  const isWindows = process.platform === 'win32';
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const extensions = isWindows ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const name of exes) {
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const ext of extensions) {
        const full = path.join(dir, isWindows && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name);
        if (fs.existsSync(full)) {
          try {
            const stat = fs.statSync(full);
            if (stat.isFile()) return full;
          } catch {
            // ignore
          }
        }
      }
    }
  }
  return null;
}

function getExecutableVersion(exePath) {
  if (!exePath) return null;
  try {
    const out = execFileSync(exePath, ['--version'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.trim().match(/v?(\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?)/);
    return match ? match[0] : out.trim().split(/\r?\n/)[0].slice(0, 40);
  } catch {
    return null;
  }
}

module.exports = {
  backupFile,
  readJsonIfExists,
  writeJson,
  upsertEnvValue,
  removeEnvValue,
  findExecutable,
  getExecutableVersion,
};
