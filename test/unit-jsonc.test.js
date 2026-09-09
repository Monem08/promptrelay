'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripJSONC, parseJSONC } = require('../src/opencode/jsonc');

test('parseJSONC strips line and block comments', () => {
  const text = `{
    // line comment
    "a": 1, /* block */ "b": 2
  }`;
  assert.deepEqual(parseJSONC(text), { a: 1, b: 2 });
});

test('parseJSONC removes trailing commas', () => {
  const text = `{ "a": [1, 2, 3,], "b": { "c": 1, }, }`;
  assert.deepEqual(parseJSONC(text), { a: [1, 2, 3], b: { c: 1 } });
});

test('stripJSONC preserves // inside string values', () => {
  const text = `{ "url": "https://example.com/v1", "note": "a // b" }`;
  const obj = parseJSONC(text);
  assert.equal(obj.url, 'https://example.com/v1');
  assert.equal(obj.note, 'a // b');
});

test('parseJSONC throws helpful error on invalid input', () => {
  assert.throws(() => parseJSONC('{ not json }'), /Invalid JSON\/JSONC/);
});
