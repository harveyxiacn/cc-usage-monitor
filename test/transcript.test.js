'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { sumSessionTokens } = require('../lib/transcript');

const FIXTURE = path.join(__dirname, 'fixtures', 'transcript-3-turns.jsonl');

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
