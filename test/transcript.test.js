'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { sumSessionTokens } = require('../lib/transcript');

const FIXTURE = path.join(__dirname, 'fixtures', 'transcript-3-turns.jsonl');
const FABLE_FIXTURE = path.join(__dirname, 'fixtures', 'transcript-fable.jsonl');

test('sumSessionTokens: dedupes by message.id and sums correctly', async () => {
  const r = await sumSessionTokens(FIXTURE);
  assert.ok(r, 'expected a result object, got null');
  assert.equal(r.messageCount, 3, 'should count 3 unique assistant messages despite 6 duplicate lines');
  assert.equal(r.inputTokens, 10 + 5 + 2);
  assert.equal(r.cacheCreationTokens, 200 + 100 + 50);
  assert.equal(r.cacheReadTokens, 0 + 210 + 315);
  assert.equal(r.outputTokens, 50 + 80 + 120);
  // Malformed line should be counted but not crash:
  assert.ok(r.parseFailures >= 1, 'expected at least one parse failure for the malformed line');
});

test('sumSessionTokens: buckets tokens per model (single-model session)', async () => {
  const r = await sumSessionTokens(FIXTURE);
  assert.ok(r.models);
  const keys = Object.keys(r.models);
  assert.deepEqual(keys, ['claude-opus-4-7']);
  const m = r.models['claude-opus-4-7'];
  assert.equal(m.inputTokens, 17);
  assert.equal(m.outputTokens, 250);
  assert.equal(m.cacheReadTokens, 525);
  assert.equal(m.cacheCreationTokens, 350);
});

test('sumSessionTokens: buckets tokens per model (mixed Fable 5 + Haiku session)', async () => {
  const r = await sumSessionTokens(FABLE_FIXTURE);
  assert.ok(r.models);
  const fable = r.models['claude-fable-5'];
  assert.ok(fable, 'expected a claude-fable-5 bucket');
  assert.equal(fable.inputTokens, 150);
  assert.equal(fable.outputTokens, 1200);
  assert.equal(fable.cacheReadTokens, 2100);
  assert.equal(fable.cacheCreationTokens, 2100);
  const haiku = r.models['claude-haiku-4-5-20251001'];
  assert.ok(haiku, 'expected a haiku bucket');
  assert.equal(haiku.inputTokens, 1200);
  assert.equal(haiku.outputTokens, 2000);
  // Grand totals still cover every model:
  assert.equal(r.inputTokens, 150 + 1200);
  assert.equal(r.outputTokens, 1200 + 2000);
});

test('sumSessionTokens: derives cache-write total from the per-TTL breakdown', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-ttl-${Date.now()}.jsonl`);
  // Payload carries the cache_creation breakdown but no legacy total.
  fs.writeFileSync(tmp, JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_ttl_001',
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'text', text: 'x' }],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 400 },
      },
    },
  }) + '\n');
  try {
    const r = await sumSessionTokens(tmp);
    assert.equal(r.cacheCreationTokens, 700); // 300 + 400, despite missing legacy total
    const m = r.models['claude-fable-5'];
    assert.equal(m.cacheCreationTokens, 700);
    assert.equal(m.cacheCreation1hTokens, 400);
    assert.equal(r.truncated, false);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('sumSessionTokens: returns null when path is missing/invalid', async () => {
  assert.equal(await sumSessionTokens(null), null);
  assert.equal(await sumSessionTokens(''), null);
  assert.equal(await sumSessionTokens('/nonexistent/path/that/does/not/exist.jsonl'), null);
});

test('sumSessionTokens: empty file returns zeroed result', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-empty-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, '');
  try {
    const r = await sumSessionTokens(tmp);
    assert.ok(r);
    assert.equal(r.messageCount, 0);
    assert.equal(r.inputTokens, 0);
    assert.equal(r.outputTokens, 0);
    assert.equal(r.cacheReadTokens, 0);
    assert.equal(r.cacheCreationTokens, 0);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('sumSessionTokens: skips non-assistant entries', async () => {
  // The fixture contains user, summary, tool_result, permission-mode entries
  // — they must not contribute to totals. Verified implicitly by exact-equal
  // assertions in the dedupe test above; this is an extra smoke check.
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-only-user-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, [
    '{"type":"user","message":{"role":"user","content":"hi"}}',
    '{"type":"tool_result","content":"ok"}',
    '{"type":"summary","summary":"x"}',
  ].join('\n') + '\n');
  try {
    const r = await sumSessionTokens(tmp);
    assert.ok(r);
    assert.equal(r.messageCount, 0);
    assert.equal(r.inputTokens, 0);
    assert.equal(r.outputTokens, 0);
  } finally {
    fs.unlinkSync(tmp);
  }
});
