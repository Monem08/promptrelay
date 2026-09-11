'use strict';

/**
 * In-memory request recorder for the PromptRelay dashboard.
 *
 * PRIVACY & ISOLATION:
 * - This is a bounded in-memory ring buffer. Nothing is written to disk.
 * - It records METADATA ONLY: never message content, never prompts, never
 *   secrets, never Authorization headers. There is no way to enable full
 *   prompt capture from this module.
 * - Recording happens AFTER a response finishes (via a 'finish' listener wired
 *   in the dispatcher), so it never sits on the proxy hot path and cannot slow
 *   down or break streaming.
 *
 * The Requests and Metrics dashboard pages read from here. When the buffer is
 * empty the API returns an empty list and the UI shows an honest "No data yet"
 * empty state — no fabricated traffic is ever produced.
 */

const EventEmitter = require('events');

const MAX_ENTRIES = 250;

/** @type {object[]} newest last */
const buffer = [];
let counter = 0;
const emitter = new EventEmitter();

function makeId() {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `req_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/**
 * Record one completed request's metadata. Unknown fields are stored as the
 * string 'unknown' (never fabricated as 0/false) so the UI can distinguish
 * "unknown" from a real zero.
 *
 * @param {object} entry
 * @returns {object} the stored record
 */
function record(entry = {}) {
  const rec = {
    id: entry.id || makeId(),
    time: entry.time || new Date().toISOString(),
    client: entry.client || 'unknown',
    ingress: entry.ingress || 'unknown',
    provider: entry.provider || 'unknown',
    model: entry.model || 'unknown',
    profile: entry.profile || 'unknown',
    status: typeof entry.status === 'number' ? entry.status : 'unknown',
    ok: typeof entry.ok === 'boolean' ? entry.ok : undefined,
    stream: typeof entry.stream === 'boolean' ? entry.stream : false,
    ttftMs: typeof entry.ttftMs === 'number' ? entry.ttftMs : 'unknown',
    totalMs: typeof entry.totalMs === 'number' ? entry.totalMs : 'unknown',
    reasoning: entry.reasoning || 'unknown',
    tools: typeof entry.tools === 'boolean' ? entry.tools : 'unknown',
    tokens: entry.tokens && typeof entry.tokens === 'object' ? entry.tokens : 'unknown',
    cost: typeof entry.cost === 'number' ? entry.cost : 'unknown',
    fallback: Boolean(entry.fallback),
    retries: typeof entry.retries === 'number' ? entry.retries : 0,
    providerAttempts: typeof entry.providerAttempts === 'number' ? entry.providerAttempts : 1,
    error: entry.error ? String(entry.error).slice(0, 300) : null,
  };
  if (rec.ok === undefined) {
    rec.ok = typeof rec.status === 'number' ? rec.status < 400 : false;
  }
  buffer.push(rec);
  while (buffer.length > MAX_ENTRIES) buffer.shift();
  emitter.emit('record', rec);
  return rec;
}

/**
 * Return recent records, newest first.
 * @param {{ limit?: number }} [options]
 */
function list(options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ENTRIES;
  return buffer.slice(-limit).reverse();
}

function get(id) {
  return buffer.find((r) => r.id === id) || null;
}

function count() {
  return buffer.length;
}

function clear() {
  buffer.length = 0;
}

/**
 * Aggregate real metrics from the buffer. Returns empty/unknown-friendly shapes
 * when there is no data — the caller/UI shows "No data yet" rather than zeros
 * masquerading as insight.
 */
function metrics() {
  const total = buffer.length;
  if (!total) {
    return {
      total: 0,
      hasData: false,
      successRate: 'unknown',
      errorCount: 0,
      medianTotalMs: 'unknown',
      medianTtftMs: 'unknown',
      byProvider: [],
      byModel: [],
      byClient: [],
      byStatus: [],
      fallbackCount: 0,
      overTime: [],
      firstAt: null,
      lastAt: null,
    };
  }

  const okCount = buffer.filter((r) => r.ok).length;
  const errorCount = total - okCount;

  const totalTimes = buffer.map((r) => r.totalMs).filter((v) => typeof v === 'number');
  const ttftTimes = buffer.map((r) => r.ttftMs).filter((v) => typeof v === 'number');

  const tally = (key) => {
    const map = new Map();
    for (const r of buffer) {
      const k = r[key];
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name: String(name), value }))
      .sort((a, b) => b.value - a.value);
  };

  // Bucket requests into per-minute buckets for the last hour of activity.
  const overTime = buildTimeBuckets(buffer);

  return {
    total,
    hasData: true,
    successRate: total ? Math.round((okCount / total) * 100) : 'unknown',
    errorCount,
    medianTotalMs: median(totalTimes),
    medianTtftMs: median(ttftTimes),
    byProvider: tally('provider'),
    byModel: tally('model'),
    byClient: tally('client'),
    byStatus: tally('status'),
    fallbackCount: buffer.filter((r) => r.fallback).length,
    overTime,
    firstAt: buffer[0].time,
    lastAt: buffer[buffer.length - 1].time,
  };
}

function median(values) {
  if (!values.length) return 'unknown';
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildTimeBuckets(entries) {
  if (!entries.length) return [];
  const BUCKET_MS = 60 * 1000; // one minute
  const map = new Map();
  for (const r of entries) {
    const t = Date.parse(r.time);
    if (Number.isNaN(t)) continue;
    const bucket = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    const cur = map.get(bucket) || { t: bucket, total: 0, ok: 0, error: 0 };
    cur.total += 1;
    if (r.ok) cur.ok += 1; else cur.error += 1;
    map.set(bucket, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ time: new Date(b.t).toISOString(), total: b.total, ok: b.ok, error: b.error }));
}

module.exports = {
  MAX_ENTRIES,
  record,
  list,
  get,
  count,
  clear,
  metrics,
  events: emitter,
  on: (event, listener) => emitter.on(event, listener),
  off: (event, listener) => emitter.off(event, listener),
  once: (event, listener) => emitter.once(event, listener),
};
