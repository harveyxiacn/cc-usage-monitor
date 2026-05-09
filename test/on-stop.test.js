'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, ON_STOP, withTranscript } = require('./helpers');

test('on-stop: full fixture prints all five sections on stderr', async () => {
  const { stdout, stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  assert.equal(stdout, '', 'on-stop should not write to stdout');
  assert.match(stderr, /cc-usage-monitor/);
  assert.match(stderr, /5h window/);
  assert.match(stderr, /7d window/);
  assert.match(stderr, /This turn/);
  // turn-level tokens (no in/out suffix in v0.3.0)
  assert.match(stderr, /↑ 16k/);
  assert.match(stderr, /↓ 1\.2k/);
  assert.match(stderr, /65% cached/);
  assert.match(stderr, /Cost/);
  assert.match(stderr, /API≈\$0\.123/);
  assert.match(stderr, /Opus/);
});

test('on-stop: full fixture + transcript path shows Session totals line', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'full.json', {}, withTranscript);
  assert.equal(code, 0);
  assert.match(stderr, /Session/);
  // Session totals: total_in = 17 + 350 + 525 = 892
  // total_out = 250
  // cache hit = 525 / 892 = 58.86 -> 59%
  assert.match(stderr, /↑ 892/);
  assert.match(stderr, /↓ 250/);
  assert.match(stderr, /59% cached/);
  assert.match(stderr, /3 turns/);
});

test('on-stop: high-usage fixture flags both rate-limit windows', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'high-usage.json');
  assert.equal(code, 0);
  assert.match(stderr, /95%/);
  assert.match(stderr, /88%/);
});

test('on-stop: no rate_limits + only cost prints Cost line, no rate-limit lines', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'no-rate-limits.json');
  assert.equal(code, 0);
  assert.match(stderr, /Cost/);
  assert.match(stderr, /Haiku/);
  assert.doesNotMatch(stderr, /5h window/);
  assert.doesNotMatch(stderr, /7d window/);
});

test('on-stop: missing-cost fixture still prints rate-limit windows', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'missing-cost.json');
  assert.equal(code, 0);
  assert.match(stderr, /5h window/);
  assert.match(stderr, /7d window/);
});

test('on-stop: no-cache fixture shows This turn without cache hit', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'no-cache.json');
  assert.equal(code, 0);
  assert.match(stderr, /This turn/);
  assert.match(stderr, /↑ 8\.0k/);
  assert.match(stderr, /↓ 600/);
  assert.doesNotMatch(stderr, /cached/);
});

test('on-stop: CC_USAGE_MONITOR_QUIET=1 silences output', async () => {
  const { stdout, stderr, code } = await runScript(ON_STOP, 'full.json', {
    CC_USAGE_MONITOR_QUIET: '1',
  });
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('on-stop: full fixture prints Context line with bar and absolute size', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  assert.match(stderr, /Context/);
  assert.match(stderr, /12%/);
  assert.match(stderr, /16k of 200k/);
});

test('on-stop: missing transcript_path does NOT print Session line', async () => {
  // full.json has no transcript_path, so session totals shouldn't appear
  const { stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  // "Session" should not appear as a section label (cost line is "Cost", turn line is "This turn")
  assert.doesNotMatch(stderr, /Session\s+↑/);
});
