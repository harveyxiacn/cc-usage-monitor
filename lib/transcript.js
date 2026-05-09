'use strict';

/**
 * Walk a Claude Code session transcript JSONL file and sum token usage
 * across the whole session.
 *
 * Important: Claude Code logs every assistant message multiple times — once
 * per content block (thinking, text, tool_use) — so naively summing
 * `message.usage` across all assistant entries triple-counts. We dedupe by
 * `message.id` (the Anthropic API message ID, unique per response) so each
 * response is counted exactly once.
 *
 * Also: streaming intermediate entries can have `usage.input_tokens` set to
 * a placeholder (often 0 or 1). The real input cost lives in
 * `cache_creation_input_tokens + cache_read_input_tokens`, so we just sum
 * all four fields and let cache + creation absorb the bulk.
 */

const fs = require('node:fs');
const readline = require('node:readline');

async function sumSessionTokens(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;

  let fileSize = 0;
  try {
    fileSize = fs.statSync(transcriptPath).size;
  } catch {
    return null; // file missing or unreadable
  }
  if (fileSize === 0) return zeroResult();

  // Hard cap to avoid runaway reads. 50 MB is comfortably above any real
  // session (a 4 MB session is already ~1000 turns) and ensures the Stop
  // hook never blocks Claude Code on a pathological file.
  const MAX_BYTES = 50 * 1024 * 1024;
  if (fileSize > MAX_BYTES) return null;

  const seenIds = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let messageCount = 0;
  let parseFailures = 0;

  return new Promise((resolve) => {
    const stream = fs.createReadStream(transcriptPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const finish = () => resolve({
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      messageCount,
      parseFailures,
    });

    rl.on('line', (line) => {
      if (!line) return;
      let evt;
      try { evt = JSON.parse(line); }
      catch { parseFailures++; return; }

      if (!evt || evt.type !== 'assistant') return;
      const msg = evt.message;
      if (!msg || typeof msg !== 'object') return;
      const usage = msg.usage;
      if (!usage || typeof usage !== 'object') return;

      const id = msg.id;
      if (id) {
        if (seenIds.has(id)) return;
        seenIds.add(id);
      }

      inputTokens += toNum(usage.input_tokens);
      outputTokens += toNum(usage.output_tokens);
      cacheReadTokens += toNum(usage.cache_read_input_tokens);
      cacheCreationTokens += toNum(usage.cache_creation_input_tokens);
      messageCount++;
    });

    rl.on('close', finish);
    rl.on('error', finish);
    stream.on('error', finish);

    // Watchdog: if reading takes more than 1500ms, give up with what we have.
    setTimeout(() => {
      try { rl.close(); } catch { /* noop */ }
      try { stream.destroy(); } catch { /* noop */ }
      finish();
    }, 1500).unref();
  });
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function zeroResult() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    messageCount: 0,
    parseFailures: 0,
  };
}

module.exports = { sumSessionTokens };
