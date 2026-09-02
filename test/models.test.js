'use strict';

/**
 * End-to-end checks for the 2026-09 model roster (Fable 5.1, Opus 5,
 * Sonnet 5) across both surfaces. Unit-level pricing math lives in
 * pricing.test.js; this file proves the numbers survive the transcript
 * walker → pricing → renderer pipeline.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runScript, STATUSLINE, ON_STOP, FIXTURES_DIR } = require('./helpers');

const TRANSCRIPT_FABLE_5_1 = path.join(FIXTURES_DIR, 'transcript-fable-5-1.jsonl');

function withFable51Transcript(payload) {
  payload.transcript_path = TRANSCRIPT_FABLE_5_1;
  return payload;
}

test('statusline: raw claude-fable-5-1[1m] id renders as "Fable 5.1"', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable-5-1.json');
  assert.equal(code, 0);
  assert.match(stdout, /Fable 5\.1/);
  assert.doesNotMatch(stdout, /\[1m\]/);
  assert.doesNotMatch(stdout, /Fable 5 /); // not the Fable 5 row
});

test('statusline: Fable 5.1 + Sonnet 5 transcript prices cache reads at $0.25/MTok', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable-5-1.json', {}, withFable51Transcript);
  assert.equal(code, 0);
  // Fable 5.1: 150×$10 + 1200×$50 + 2100×$0.25 + 2100×$12.5 per MTok = $0.088275
  // Sonnet 5:  1200×$2 + 2000×$10 per MTok                            = $0.0224
  // Total $0.110675 → "$0.111". Under Fable 5's $1 cache reads the Fable
  // bucket alone would be $0.08985, so a wrong rate shows up here.
  assert.match(stdout, /API≈~\$0\.111/);
});

test('on-stop: Fable 5.1 + Sonnet 5 session shows the per-model breakdown at new rates', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'fable-5-1.json', {}, withFable51Transcript);
  assert.equal(code, 0);
  assert.match(stderr, /Fable 5\.1/);
  assert.match(stderr, /API≈\$0\.111 \(est\.\)/);
  assert.match(stderr, /Models/);
  assert.match(stderr, /Fable 5\.1 \$0\.088/);
  assert.match(stderr, /Sonnet 5 \$0\.022/);
});

test('statusline: a Claude Code display_name still beats the registry name', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable-5-1.json', {}, (p) => {
    p.model.display_name = 'Fable';
    return p;
  });
  assert.equal(code, 0);
  assert.match(stdout, /^Fable /);
  assert.doesNotMatch(stdout, /Fable 5\.1/);
});
