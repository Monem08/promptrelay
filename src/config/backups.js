'use strict';

/**
 * Backup management utilities.
 * Lists, restores, and cleans backups for PromptRelay configuration files.
 */

const { listBackups, restoreBackup, createBackup, BACKUP_DIR_NAME } = require('./safe-write');

/**
 * List all backups for a config file, sorted newest first.
 */
function list(filePath) {
  return listBackups(filePath);
}

/**
 * Restore a backup by index (0 = most recent).
 * @param {string} filePath - Original file path
 * @param {number} index - Backup index (0 = newest)
 * @returns {{ restored: boolean, backupFile: string|null, error: string|null }}
 */
function restoreByIndex(filePath, index = 0) {
  const backups = listBackups(filePath);
  if (!backups.length) {
    return { restored: false, backupFile: null, error: 'No backups found' };
  }
  if (index < 0 || index >= backups.length) {
    return { restored: false, backupFile: null, error: `Invalid backup index ${index}. ${backups.length} backups available.` };
  }
  const target = backups[index];
  const result = restoreBackup(target.path, filePath);
  return { ...result, backupFile: target.path, backupName: target.name };
}

/**
 * Restore a backup by file path.
 */
function restoreByPath(backupFile, targetFile) {
  return restoreBackup(backupFile, targetFile);
}

/**
 * Clean old backups, keeping the N most recent.
 * @param {string} filePath - Original file path
 * @param {number} keep - Number of recent backups to keep
 * @returns {{ removed: number, kept: number }}
 */
function cleanBackups(filePath, keep = 10) {
  const fs = require('fs');
  const backups = listBackups(filePath);
  let removed = 0;
  for (let i = keep; i < backups.length; i++) {
    try {
      fs.unlinkSync(backups[i].path);
      removed++;
    } catch { /* best effort */ }
  }
  return { removed, kept: Math.min(backups.length, keep) };
}

module.exports = { list, restoreByIndex, restoreByPath, cleanBackups, BACKUP_DIR_NAME };
