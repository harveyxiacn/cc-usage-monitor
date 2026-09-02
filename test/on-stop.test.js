'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, ON_STOP, withTranscript, withFableTranscript } = require('./helpers');
const { stripAnsi } = require('../lib/format');

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

test('on-stop: no-cache fixture shows This turn with 0% cache bar', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'no-cache.json');
  assert.equal(code, 0);
  assert.match(stderr, /This turn/);
  assert.match(stderr, /↑ 8\.0k/);
  assert.match(stderr, /↓ 600/);
  // 0% is shown as a red bar — every metric with a bounded scale gets one
  assert.match(stderr, /0%/);
  assert.match(stderr, /cached/);
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

test('on-stop: full fixture has cache hit bar in This turn line', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  // 12-cell bar followed by " 65% cached"
  assert.match(stderr, /▰{8}▱{4} {1,2}65% cached/);
});

test('on-stop: full fixture + transcript has cache hit bar in Session line too', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'full.json', {}, withTranscript);
  assert.equal(code, 0);
  // Session cache 59% should render as ▰▰▰▰▰▰▰▱▱▱▱▱ 59% cached
  assert.match(stderr, /▰{7}▱{5} {1,2}59% cached/);
});

test('on-stop: fable fixture + transcript shows estimated cost and per-model breakdown', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'fable.json', {}, withFableTranscript);
  assert.equal(code, 0);
  // Raw "claude-fable-5[1m]" id renders as the friendly name.
  assert.match(stderr, /Fable 5/);
  // No total_cost_usd in the fixture — cost is computed from the pricing
  // table and flagged as an estimate.
  assert.match(stderr, /API≈\$0\.101 \(est\.\)/);
  // Mixed-model session → Models breakdown, ordered by cost.
  assert.match(stderr, /Models/);
  assert.match(stderr, /Fable 5 \$0\.090/);
  assert.match(stderr, /Haiku 4\.5 \$0\.011/);
});

test('on-stop: single-model session omits the Models breakdown line', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'full.json', {}, withTranscript);
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /Models/);
});

test('on-stop: reported cost wins and is not marked as estimate', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'fable.json', {}, (p) => {
    withFableTranscript(p);
    p.cost.total_cost_usd = 1.5;
    return p;
  });
  assert.equal(code, 0);
  assert.match(stderr, /API≈\$1\.50/);
  assert.doesNotMatch(stderr, /est\./);
});

test('on-stop: missing transcript_path does NOT print Session line', async () => {
  // full.json has no transcript_path, so session totals shouldn't appear
  const { stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  // "Session" should not appear as a section label (cost line is "Cost", turn line is "This turn")
  assert.doesNotMatch(stderr, /Session\s+↑/);
});

// --- style presets -------------------------------------------------------
//
// The box has to follow the same preset as the statusline: bar width from
// `boxBarWidth`, borders and the bullet from `theme.box`, and the color
// rules of the mode. Every row must stay inside the frame.

const styledBox = (name, fixture = 'full.json', env = {}, mutate = null) =>
  runScript(ON_STOP, fixture, { CC_USAGE_MONITOR_STYLE: name, ...env }, mutate);

/** Every rendered row must be the same visible width, or the frame is broken. */
function assertRectangular(stderr) {
  const lines = stripAnsi(stderr).replace(/\n$/, '').split('\n');
  assert.ok(lines.length >= 3, `expected a box, got: ${JSON.stringify(stderr)}`);
  const width = lines[0].length;
  for (const line of lines) {
    assert.equal(line.length, width, `ragged box row: ${JSON.stringify(line)}`);
  }
  return lines;
}

test('on-stop style classic: naming the default matches the default box', async () => {
  const named = await styledBox('classic');
  const implicit = await runScript(ON_STOP, 'full.json');
  assert.equal(named.code, 0);
  assert.equal(named.stderr, implicit.stderr);
});

test('on-stop style ascii: the whole box is 7-bit ASCII with + corners', async () => {
  const { stderr, code } = await styledBox('ascii', 'fable.json', {}, withFableTranscript);
  assert.equal(code, 0);
  assert.match(stripAnsi(stderr), /^[\x00-\x7f]*$/);
  const lines = assertRectangular(stderr);
  assert.ok(lines[0].startsWith('+-'), lines[0]);
  assert.ok(lines[0].endsWith('-+'), lines[0]);
  assert.ok(lines[lines.length - 1].startsWith('+-'), lines[lines.length - 1]);
  assert.match(stderr, /\| 5h window/);
  assert.match(stderr, /\[#+-*\]/);       // ASCII bar in brackets
  assert.match(stderr, / \* /);            // ASCII bullet
  assert.match(stderr, /API=\$/);          // ASCII approx
  assert.match(stderr, /\^ 320k/);         // ASCII up glyph
});

test('on-stop style minimal: percentages only, no bar cells', async () => {
  const { stderr, code } = await styledBox('minimal');
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /▰/);
  assert.doesNotMatch(stderr, /▱/);
  assert.match(stderr, /5h window\s+24%/);
  assert.match(stderr, /65% cached/);
  assertRectangular(stderr);
});

test('on-stop style mono: no color codes anywhere in the box', async () => {
  const { stderr, code } = await styledBox('mono', 'high-usage.json', { NO_COLOR: '' });
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /\x1b\[(3\d|9\d|4\d|10\d)m/);
  assert.match(stderr, /━/);
  // 95.4% is past the red threshold, so it renders bold instead.
  assert.match(stderr, /\x1b\[1m/);
  assertRectangular(stderr);
});

test('on-stop style compact/detailed: boxBarWidth drives the bar length', async () => {
  const compact = await styledBox('compact');
  assert.equal(compact.code, 0);
  assert.match(compact.stderr, /5h window {2}[█░]{8} {2}/);
  assert.doesNotMatch(compact.stderr, /[█░]{9}/);
  assertRectangular(compact.stderr);

  const detailed = await styledBox('detailed');
  assert.equal(detailed.code, 0);
  assert.match(detailed.stderr, /5h window {2}[▰▱]{16} {2}/);
  assertRectangular(detailed.stderr);
});

test('on-stop style bracket: box bars are wrapped in square brackets', async () => {
  const { stderr, code } = await styledBox('bracket');
  assert.equal(code, 0);
  assert.match(stderr, /\[[▰▱]{12}\]/);
  assertRectangular(stderr);
});

test('on-stop styles emoji, badge and dots each print an intact box', async () => {
  for (const name of ['emoji', 'badge', 'dots']) {
    const { stderr, code } = await styledBox(name);
    assert.equal(code, 0, name);
    assert.match(stderr, /cc-usage-monitor/, name);
    assert.match(stderr, /5h window/, name);
    assertRectangular(stderr);
  }
});

test('on-stop style dots: the box uses the round bar glyphs', async () => {
  const { stderr, code } = await styledBox('dots');
  assert.equal(code, 0);
  assert.match(stderr, /[●○]{12}/);
});

test('on-stop style badge: pills stay out of the box, colors stay in', async () => {
  const { stderr, code } = await styledBox('badge', 'full.json', { NO_COLOR: '' });
  assert.equal(code, 0);
  // No background codes inside the frame — the box renders like classic.
  assert.doesNotMatch(stderr, /\x1b\[4[0-7]m/);
  assert.doesNotMatch(stderr, /\x1b\[10[0-7]m/);
  assert.match(stderr, /\x1b\[36m/); // ordinary foreground color still there
  assertRectangular(stderr);
});

test('on-stop style: the config file selects the box style too', async () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-style-box-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ style: 'ascii' }));
  try {
    const { stderr, code } = await runScript(ON_STOP, 'full.json', { CC_USAGE_MONITOR_CONFIG: tmp });
    assert.equal(code, 0);
    assert.match(stripAnsi(stderr), /^[\x00-\x7f]*$/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
