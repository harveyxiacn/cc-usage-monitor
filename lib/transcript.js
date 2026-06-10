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
  let truncated = false;
  // Per-model buckets so cost can be priced accurately even when a session
  // mixes models (main loop on one model, subagents on another).
  const models = Object.create(null);

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
      models,
      // True when the watchdog cut the walk short — totals are partial, so
      // callers must not present derived figures (e.g. computed cost) as
      // complete.
      truncated,
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

      const inTok = toNum(usage.input_tokens);
      const outTok = toNum(usage.output_tokens);
      const readTok = toNum(usage.cache_read_input_tokens);
      // Newer payloads break cache writes down by TTL — the 1-hour subset
      // is billed at 2× input instead of 1.25×, so track it separately.
      // Derive the total from the breakdown too, in case a payload carries
      // only the per-TTL fields and not the legacy total.
      let writeTok = toNum(usage.cache_creation_input_tokens);
      let write1hTok = 0;
      if (usage.cache_creation && typeof usage.cache_creation === 'object') {
        const write5mTok = toNum(usage.cache_creation.ephemeral_5m_input_tokens);
        write1hTok = toNum(usage.cache_creation.ephemeral_1h_input_tokens);
        writeTok = Math.max(writeTok, write5mTok + write1hTok);
      }

      inputTokens += inTok;
      outputTokens += outTok;
      cacheReadTokens += readTok;
      cacheCreationTokens += writeTok;
      messageCount++;

      const modelId = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
      const bucket = models[modelId]
        || (models[modelId] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation1hTokens: 0,
        });
      bucket.inputTokens += inTok;
      bucket.outputTokens += outTok;
      bucket.cacheReadTokens += readTok;
      bucket.cacheCreationTokens += writeTok;
      bucket.cacheCreation1hTokens += write1hTok;
    });

    rl.on('close', finish);
    rl.on('error', finish);
    stream.on('error', finish);

    // Watchdog: if reading takes more than 1500ms, give up with what we have.
    setTimeout(() => {
      truncated = true;
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
    models: Object.create(null),
    truncated: false,
  };
}

module.exports = { sumSessionTokens };
