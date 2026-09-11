'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  safeWrite,
  safeWriteJson,
  safeWriteSync,
  safeWriteJsonSync,
  createBackup,
  listBackups,
  restoreBackup,
} = require('../src/config/safe-write');

const backups = require('../src/config/backups');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-safe-write-'));
}

describe('safe-write: atomic write with backup', () => {
  let dir;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('safeWriteSync creates file and backup on update', () => {
    const file = path.join(dir, 'test1.json');
    fs.writeFileSync(file, '{"a":1}\n', 'utf8');

    const result = safeWriteJsonSync(file, { a: 2, b: 3 });
    assert.equal(result.ok, true);
    assert.ok(result.backupPath, 'should have a backup path');
    assert.ok(fs.existsSync(result.backupPath), 'backup file should exist');

    // Verify the backup contains original content
    const backupContent = JSON.parse(fs.readFileSync(result.backupPath, 'utf8'));
    assert.equal(backupContent.a, 1);

    // Verify new content
    const newContent = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(newContent.a, 2);
    assert.equal(newContent.b, 3);
  });

  it('safeWriteSync with no existing file creates without backup', () => {
    const file = path.join(dir, 'test_new.json');
    const result = safeWriteJsonSync(file, { fresh: true });
    assert.equal(result.ok, true);
    assert.equal(result.backupPath, null);
    assert.ok(fs.existsSync(file));
  });

  it('safeWriteSync with validation failure does not modify file', () => {
    const file = path.join(dir, 'test_validate.json');
    fs.writeFileSync(file, '{"original":true}\n', 'utf8');

    const result = safeWriteSync({
      filePath: file,
      content: 'not valid json',
      validate: (c) => {
        try { JSON.parse(c); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
      },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    // Original file should be unchanged
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(content.original, true);
  });

  it('safeWriteSync createBackup=false skips backup', () => {
    const file = path.join(dir, 'test_nobackup.json');
    fs.writeFileSync(file, '{"v":1}\n', 'utf8');
    const result = safeWriteJsonSync(file, { v: 2 }, { createBackup: false });
    assert.equal(result.ok, true);
    assert.equal(result.backupPath, null);
  });

  it('async safeWriteJson creates file with backup', async () => {
    const file = path.join(dir, 'test_async.json');
    fs.writeFileSync(file, '{"x":1}\n', 'utf8');
    const result = await safeWriteJson(file, { x: 2 });
    assert.equal(result.ok, true);
    assert.ok(result.backupPath);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(content.x, 2);
  });

  it('async safeWrite validation failure returns error', async () => {
    const file = path.join(dir, 'test_async_fail.json');
    fs.writeFileSync(file, '{"ok":true}\n', 'utf8');
    const result = await safeWrite({
      filePath: file,
      content: '{invalid',
      validate: (c) => {
        try { JSON.parse(c); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
      },
    });
    assert.equal(result.ok, false);
    // Original preserved
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
  });
});

describe('safe-write: createBackup and listBackups', () => {
  let dir;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('createBackup returns null for non-existent file', () => {
    const result = createBackup(path.join(dir, 'nope.json'));
    assert.equal(result.backupPath, null);
    assert.equal(result.existed, false);
  });

  it('listBackups returns empty for non-existent file', () => {
    const list = listBackups(path.join(dir, 'nope.json'));
    assert.deepEqual(list, []);
  });

  it('createBackup creates backup and listBackups finds it', () => {
    const file = path.join(dir, 'cfg.json');
    fs.writeFileSync(file, '{"v":1}', 'utf8');
    const result = createBackup(file);
    assert.ok(result.backupPath);
    assert.equal(result.existed, true);

    const list = listBackups(file);
    assert.ok(list.length >= 1);
    assert.ok(list[0].path.includes('cfg_'));
  });
});

describe('backups module', () => {
  let dir;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('restoreByIndex restores most recent backup', () => {
    const file = path.join(dir, 'restore_test.json');
    fs.writeFileSync(file, '{"version":1}', 'utf8');
    createBackup(file);
    fs.writeFileSync(file, '{"version":2}', 'utf8');

    const result = backups.restoreByIndex(file, 0);
    assert.equal(result.restored, true);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(content.version, 1);
  });

  it('restoreByIndex returns error for no backups', () => {
    const file = path.join(dir, 'no_backups.json');
    const result = backups.restoreByIndex(file, 0);
    assert.equal(result.restored, false);
    assert.ok(result.error);
  });

  it('cleanBackups removes old backups', () => {
    const file = path.join(dir, 'clean_test.json');
    fs.writeFileSync(file, '{"v":1}', 'utf8');
    for (let i = 0; i < 5; i++) {
      createBackup(file);
    }
    const before = backups.list(file);
    assert.ok(before.length >= 5);
    const result = backups.cleanBackups(file, 2);
    assert.ok(result.removed >= 3);
    const after = backups.list(file);
    assert.ok(after.length <= 2);
  });
});
