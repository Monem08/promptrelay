'use strict';

/**
 * Minimal Server-Sent Events helpers used by the IR translation layer.
 *
 * `iterSSE` consumes a WHATWG ReadableStream (the body returned by `fetch`) and
 * yields parsed `{ event, data }` records. It is deliberately tolerant: OpenAI
 * streams omit the `event:` line (event === null) while Anthropic always sends
 * one. Comment lines (":...") and blank keep-alives are skipped.
 *
 * `formatSSE` renders an event back onto the wire. When `event` is null only a
 * `data:` line is emitted (OpenAI style); otherwise an `event:` line precedes it
 * (Anthropic style).
 */

/**
 * Parse a single SSE block (the text between blank-line separators) into
 * { event, data } where data is the concatenation of all data: lines.
 * Returns null when the block has no data payload.
 */
function parseSSEBlock(block) {
  let event = null;
  const dataLines = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0 && event === null) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * Async-iterate SSE records from a fetch ReadableStream (or any async iterable
 * of Uint8Array / Buffer / string chunks).
 * @param {ReadableStream|AsyncIterable} body
 * @returns {AsyncGenerator<{event:string|null,data:string}>}
 */
async function* iterSSE(body) {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = '';

  const pump = async function* () {
    // Support both WHATWG ReadableStream (getReader) and async iterables.
    if (typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        try { reader.releaseLock(); } catch { /* noop */ }
      }
    } else {
      for await (const chunk of body) yield chunk;
    }
  };

  for await (const chunk of pump()) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let sep;
    // SSE records are separated by a blank line (\n\n). Tolerate \r\n\r\n.
    while ((sep = firstSeparator(buffer)) !== -1) {
      const rawBlock = buffer.slice(0, sep.index);
      buffer = buffer.slice(sep.index + sep.length);
      const record = parseSSEBlock(rawBlock);
      if (record) yield record;
    }
  }

  // Flush any trailing block (streams that end without a final blank line).
  const tail = buffer.trim();
  if (tail) {
    const record = parseSSEBlock(tail);
    if (record) yield record;
  }
}

function firstSeparator(buffer) {
  const a = buffer.indexOf('\n\n');
  const b = buffer.indexOf('\r\n\r\n');
  if (a === -1 && b === -1) return -1;
  if (a === -1) return { index: b, length: 4 };
  if (b === -1) return { index: a, length: 2 };
  return a < b ? { index: a, length: 2 } : { index: b, length: 4 };
}

/**
 * Format an SSE event for the wire.
 * @param {string|null} event  Event name, or null for OpenAI-style data-only.
 * @param {*} data             Object (JSON-stringified) or raw string.
 * @returns {string}
 */
function formatSSE(event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const head = event ? `event: ${event}\n` : '';
  return `${head}data: ${payload}\n\n`;
}

module.exports = {
  iterSSE,
  parseSSEBlock,
  formatSSE,
};
