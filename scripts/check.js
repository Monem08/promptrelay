#!/usr/bin/env node

'use strict';

/**
 * Portable syntax checker: recursively runs `node --check` on every .js file
 * under bin/ and src/. Replaces a brittle hand-maintained list of files in the
 * npm `check` script so new modules are always covered.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['bin', 'src'];

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collect(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
}

const files = [];
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) collect(abs, files);
}

let failed = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`✗ ${path.relative(ROOT, file)}\n${result.stderr}`);
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`✓ Syntax OK for ${files.length} file(s).`);
