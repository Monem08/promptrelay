'use strict';

/**
 * Shared safe-write layer for PromptRelay configuration.
 *
 * Every configuration mutation flows through this module to ensure:
 *   1. Advisory lock prevents conflicting concurrent writes.
 *   2. Current file is read and validated.
 *   3. A timestamped backup is created before changes.
 *   4. Content is written to a temporary file first.
 *   5. Temporary content is validated.
 *   6. Atomic rename replaces the original.
 *   7. On any failure, the backup is restored automatically.
 *   8. A structured result is returned.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const BACKUP_DIR_NAME = 'backups';

// In-process write locks keyed by absolute file path.
const locks = new Map();

/**
 * Acquire an in-process advisory lock for a file path.
 * Returns a release function. Waits if another write is in progress.
 */
function acquireLock(filePath) {
  const key = path.resolve(filePath);
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (!locks.has(key)) {
        let releaseCallback;
        const promise = new Promise((r) => { releaseCallback = r; });
        locks.set(key, { promise, release: releaseCallback });
        resolve(() => {
          locks.delete(key);
          releaseCallback();
        });
      } else {
        locks.get(key).promise.then(tryAcquire);
      }
    };
    tryAcquire();
  });
}

/**
 * Generate a timestamped backup filename.
 * @param {string} filePath - Original file path
 * @returns {string} Backup file path
 */
function backupPath(filePath, backupDir) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rand = crypto.randomBytes(3).toString('hex');
  return path.join(backupDir, `${base}_${timestamp}_${rand}${ext}`);
}

/**
 * Ensure the backup directory exists.
 * @param {string} filePath - The file being backed up
 * @returns {string} The backup directory path
 */
function ensureBackupDir(filePath) {
  const dir = path.join(path.dirname(filePath), BACKUP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a timestamped backup of a file.
 * @param {string} filePath - File to back up
 * @returns {{ backupPath: string|null, existed: boolean }}
 */
function createBackup(filePath) {
  if (!fs.existsSync(filePath)) {
    return { backupPath: null, existed: false };
  }
  const dir = ensureBackupDir(filePath);
  const dest = backupPath(filePath, dir);
  fs.copyFileSync(filePath, dest);
  return { backupPath: dest, existed: true };
}

/**
 * List all backups for a given config file.
 * @param {string} filePath - Original file path
 * @returns {Array<{ path: string, name: string, size: number, mtime: Date }>}
 */
function listBackups(filePath) {
  const dir = path.join(path.dirname(filePath), BACKUP_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const prefix = `${base}_`;
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { path: full, name: f, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Restore a specific backup to the original location.
 * @param {string} backupFile - Backup file to restore
 * @param {string} targetFile - Where to restore it
 * @returns {{ restored: boolean, backupPath: string|null }}
 */
function restoreBackup(backupFile, targetFile) {
  if (!fs.existsSync(backupFile)) {
    return { restored: false, error: 'Backup file not found' };
  }
  // Create a backup of current state before restoring
  const pre = createBackup(targetFile);
  fs.copyFileSync(backupFile, targetFile);
  return { restored: true, previousBackup: pre.backupPath };
}

/**
 * Perform a safe, atomic write.
 *
 * @param {object} options
 * @param {string} options.filePath - Target file path
 * @param {string} options.content - New content to write
 * @param {function} [options.validate] - Optional validator (content) => { ok, error }
 * @param {boolean} [options.createBackup=true] - Whether to create a backup
 * @returns {Promise<{ ok: boolean, backupPath: string|null, error: string|null }>}
 */
async function safeWrite(options) {
  const { filePath, content, validate, createBackup: doBackup = true } = options;
  const absPath = path.resolve(filePath);
  const release = await acquireLock(absPath);

  try {
    // Step 1: Read current file (if exists)
    let previousContent = null;
    if (fs.existsSync(absPath)) {
      previousContent = fs.readFileSync(absPath, 'utf8');
    }

    // Step 2: Create timestamped backup
    let backup = { backupPath: null, existed: false };
    if (doBackup && previousContent !== null) {
      backup = createBackup(absPath);
    }

    // Step 3: Validate new content before writing
    if (typeof validate === 'function') {
      const result = validate(content);
      if (result && !result.ok) {
        return { ok: false, backupPath: backup.backupPath, error: result.error || 'Validation failed' };
      }
    }

    // Step 4: Write to temporary file
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpFile = path.join(dir, `.${path.basename(absPath)}.tmp.${crypto.randomBytes(4).toString('hex')}`);

    try {
      fs.writeFileSync(tmpFile, content, 'utf8');
    } catch (writeErr) {
      // Cleanup temp file on write failure
      try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
      return { ok: false, backupPath: backup.backupPath, error: `Write failed: ${writeErr.message}` };
    }

    // Step 5: Validate the written temporary content
    if (typeof validate === 'function') {
      const tmpContent = fs.readFileSync(tmpFile, 'utf8');
      const result = validate(tmpContent);
      if (result && !result.ok) {
        try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
        return { ok: false, backupPath: backup.backupPath, error: `Post-write validation failed: ${result.error}` };
      }
    }

    // Step 6: Atomic rename (or copy+unlink on Windows if rename fails)
    try {
      fs.renameSync(tmpFile, absPath);
    } catch {
      // Cross-device fallback: copy + remove temp
      try {
        fs.copyFileSync(tmpFile, absPath);
        fs.unlinkSync(tmpFile);
      } catch (copyErr) {
        // Restore from backup
        if (backup.backupPath && fs.existsSync(backup.backupPath)) {
          try { fs.copyFileSync(backup.backupPath, absPath); } catch { /* best effort */ }
        }
        return { ok: false, backupPath: backup.backupPath, error: `Rename/copy failed: ${copyErr.message}` };
      }
    }

    return { ok: true, backupPath: backup.backupPath, error: null };
  } catch (err) {
    return { ok: false, backupPath: null, error: err.message };
  } finally {
    release();
  }
}

/**
 * Safe JSON write with automatic formatting.
 * @param {string} filePath
 * @param {object} data
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, backupPath: string|null, error: string|null }>}
 */
async function safeWriteJson(filePath, data, options = {}) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  return safeWrite({
    filePath,
    content,
    validate: (c) => {
      try {
        JSON.parse(c);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Invalid JSON: ${e.message}` };
      }
    },
    createBackup: options.createBackup !== false,
  });
}

/**
 * Synchronous safe write for backward-compatible call sites.
 * Uses the same backup + temp + rename pattern without async locking.
 */
function safeWriteSync(options) {
  const { filePath, content, validate, createBackup: doBackup = true } = options;
  const absPath = path.resolve(filePath);

  let backup = { backupPath: null, existed: false };
  if (doBackup && fs.existsSync(absPath)) {
    backup = createBackup(absPath);
  }

  if (typeof validate === 'function') {
    const result = validate(content);
    if (result && !result.ok) {
      return { ok: false, backupPath: backup.backupPath, error: result.error || 'Validation failed' };
    }
  }

  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, `.${path.basename(absPath)}.tmp.${crypto.randomBytes(4).toString('hex')}`);

  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
  } catch (writeErr) {
    try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
    return { ok: false, backupPath: backup.backupPath, error: `Write failed: ${writeErr.message}` };
  }

  try {
    fs.renameSync(tmpFile, absPath);
  } catch {
    try {
      fs.copyFileSync(tmpFile, absPath);
      fs.unlinkSync(tmpFile);
    } catch (copyErr) {
      if (backup.backupPath && fs.existsSync(backup.backupPath)) {
        try { fs.copyFileSync(backup.backupPath, absPath); } catch { /* best effort */ }
      }
      return { ok: false, backupPath: backup.backupPath, error: `Rename failed: ${copyErr.message}` };
    }
  }

  return { ok: true, backupPath: backup.backupPath, error: null };
}

function safeWriteJsonSync(filePathOrOptions, maybeData, maybeOptions = {}) {
  let filePath;
  let data;
  let options;

  if (filePathOrOptions && typeof filePathOrOptions === 'object') {
    filePath = filePathOrOptions.filePath;
    data = filePathOrOptions.data;
    options = filePathOrOptions;
  } else {
    filePath = filePathOrOptions;
    data = maybeData;
    options = maybeOptions;
  }

  const content = `${JSON.stringify(data, null, 2)}\n`;
  return safeWriteSync({
    filePath,
    content,
    validate: (c) => {
      try {
        JSON.parse(c);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Invalid JSON: ${e.message}` };
      }
    },
    createBackup: options.createBackup !== false,
  });
}

module.exports = {
  acquireLock,
  createBackup,
  listBackups,
  restoreBackup,
  ensureBackupDir,
  safeWrite,
  safeWriteJson,
  safeWriteSync,
  safeWriteJsonSync,
  BACKUP_DIR_NAME,
};
