'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, STATUSLINE, withTranscript, withFableTranscript } = require('./helpers');
const { stripAnsi } = require('../lib/format');

test('statusline: full fixture shows model + 5h + 7d + tokens + API≈cost + lines', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', { CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,session,cost' });
  assert.equal(code, 0);
  assert.match(stdout, /Opus/);
  assert.match(stdout, /5h /);
  assert.match(stdout, /7d /);
  assert.match(stdout, /24%/);   // 23.5 rounds to 24
  assert.match(stdout, /41%/);
  assert.match(stdout, /↑16k/);  // 15500 -> 16k (≥10k uses integer-rounded thousand)
  assert.match(stdout, /↓1\.2k/); // 1200 -> 1.2k
  assert.match(stdout, /API≈\$0\.123/); // labelled as API-equivalent
  assert.match(stdout, /\+156/);
  assert.match(stdout, /-23/);
  assert.match(stdout, /cache /); // cache hit segment present
  assert.match(stdout, /65%/);     // cache hit %
});

test('statusline: high-usage fixture shows 95%, 88%, big tokens, API≈cost', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'high-usage.json', { CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,cost' });
  assert.equal(code, 0);
  assert.match(stdout, /Sonnet/);
  assert.match(stdout, /95%/);
  assert.match(stdout, /88%/);
  assert.match(stdout, /↑156k/);
  assert.match(stdout, /API≈\$4\.88/);
});

test('statusline: no rate_limits fixture omits 5h/7d but keeps cost+model', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-rate-limits.json');
  assert.equal(code, 0);
  assert.match(stdout, /Haiku/);
  assert.doesNotMatch(stdout, /5h /);
  assert.doesNotMatch(stdout, /7d /);
  assert.match(stdout, /API≈\$0\.0034/);
  // no token data in this fixture
  assert.doesNotMatch(stdout, /↑/);
});

test('statusline: missing-cost fixture shows rate limits but no cost', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'missing-cost.json');
  assert.equal(code, 0);
  assert.match(stdout, /5h /);
  assert.match(stdout, /7d /);
  assert.match(stdout, /5%/);
  assert.match(stdout, /12%/);
  assert.doesNotMatch(stdout, /\$/);
});

test('statusline: no-cache fixture shows tokens but suppresses 0% cache hit', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-cache.json', { CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,cost' });
  assert.equal(code, 0);
  assert.match(stdout, /↑8\.0k/);
  assert.match(stdout, /↓600/);
  assert.doesNotMatch(stdout, /cached/);
});

test('statusline: full fixture shows context segment with bar + absolute size', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json');
  assert.equal(code, 0);
  assert.match(stdout, /ctx /);
  assert.match(stdout, /12%/);
  assert.match(stdout, /\(16k\/200k\)/);
  // 5-cell inline bar precedes the percentage
  assert.match(stdout, /ctx ▰▱▱▱▱ 12%/);
});

test('statusline: full fixture + transcript path shows Σ session segment', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {}, withTranscript);
  assert.equal(code, 0);
  // Session totals from synthetic transcript: total_in=892, total_out=250
  assert.match(stdout, /Σ↑892/);
  assert.match(stdout, /↓250/);
});

test('statusline: CC_USAGE_MONITOR_NO_SESSION=1 suppresses Σ even with transcript_path', async () => {
  const { stdout, code } = await runScript(
    STATUSLINE, 'full.json',
    { CC_USAGE_MONITOR_NO_SESSION: '1' },
    withTranscript
  );
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /Σ/);
});

test('statusline: no-rate-limits fixture omits ctx (no context_window data)', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-rate-limits.json');
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /ctx /);
});

test('statusline: CC_USAGE_MONITOR_WIDTH=80 wraps to two lines', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
    CC_USAGE_MONITOR_WIDTH: '80',
    CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,cost',
  });
  assert.equal(code, 0);
  assert.match(stdout, /\n/);
  const lines = stdout.split('\n');
  assert.equal(lines.length, 2);
  // Limits group on line 1
  assert.match(lines[0], /Opus/);
  assert.match(lines[0], /5h /);
  assert.match(lines[0], /ctx /);
  // Activity group on line 2
  assert.match(lines[1], /↑16k/);
  assert.match(lines[1], /API≈\$0\.123/);
});

test('statusline: CC_USAGE_MONITOR_WIDTH=500 keeps single line', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
    CC_USAGE_MONITOR_WIDTH: '500',
  });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\n/);
});

test('statusline: CC_USAGE_MONITOR_TWO_LINE=1 always wraps', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
    CC_USAGE_MONITOR_TWO_LINE: '1',
    CC_USAGE_MONITOR_WIDTH: '999', // wide width — would be single line normally
  });
  assert.equal(code, 0);
  assert.match(stdout, /\n/);
  const lines = stdout.split('\n');
  assert.equal(lines.length, 2);
});

test('statusline: full fixture has cache bar after tokens', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', { CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,cost' });
  assert.equal(code, 0);
  // Pattern: ↑..k ↓..k cache <bar> 65%
  assert.match(stdout, /cache ▰{3}▱{2} 65%/);
});

test('statusline: fable fixture maps raw model id to "Fable 5" and shows 1M context', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable.json');
  assert.equal(code, 0);
  // No display_name in the fixture — name comes from the pricing registry,
  // with the [1m] long-context suffix stripped.
  assert.match(stdout, /Fable 5/);
  assert.doesNotMatch(stdout, /\[1m\]/);
  assert.match(stdout, /\(320k\/1\.0M\)/);
  // No total_cost_usd and no transcript — no cost segment at all.
  assert.doesNotMatch(stdout, /\$/);
});

test('statusline: fable fixture + transcript computes API≈ cost from pricing table', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable.json', {}, withFableTranscript);
  assert.equal(code, 0);
  // Fable 5: 150×$10 + 1200×$50 + 2100×$1 + 2100×$12.5 per MTok = $0.08985
  // Haiku 4.5: 1200×$1 + 2000×$5 per MTok = $0.0112
  // Total $0.10105 → "$0.101", with ~ marking it as computed, not reported.
  assert.match(stdout, /API≈~\$0\.101/);
});

test('statusline: reported cost wins over computed cost and has no ~ marker', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'fable.json', {}, (p) => {
    withFableTranscript(p);
    p.cost.total_cost_usd = 9.99;
    return p;
  });
  assert.equal(code, 0);
  assert.match(stdout, /API≈\$9\.99/);
  assert.doesNotMatch(stdout, /~\$/);
  assert.doesNotMatch(stdout, /\$0\.101/);
});

test('statusline: CC_USAGE_MONITOR_SHOW order is preserved on a single line', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
    CC_USAGE_MONITOR_SHOW: 'cost,model,ctx',
  });
  assert.equal(code, 0);
  const cost = stdout.indexOf('API≈');
  const model = stdout.indexOf('Opus');
  const ctx = stdout.indexOf('ctx ');
  assert.ok(cost >= 0 && model >= 0 && ctx >= 0, stdout);
  assert.ok(cost < model && model < ctx, `expected cost<model<ctx order in: ${stdout}`);
});

test('statusline: CC_USAGE_MONITOR_TWO_LINE=0 keeps a single line', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
    CC_USAGE_MONITOR_TWO_LINE: '0',
    CC_USAGE_MONITOR_WIDTH: '999',
  });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\n/);
});

test('statusline: empty stdin produces a friendly waiting message and exits 0', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [STATUSLINE], {
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stdin.end(''); // empty stdin

  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.match(stdout, /waiting for first turn/);
});

test('statusline: SHOW without session/cost skips the transcript walk yet renders correctly', async () => {
  // With neither `session` nor `cost` shown, the session walk is skipped for
  // speed — output must still be correct (no Σ segment) even with a transcript.
  const { stdout, code } = await runScript(
    STATUSLINE, 'full.json',
    { CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d' },
    withTranscript
  );
  assert.equal(code, 0);
  assert.match(stdout, /Opus/);
  assert.match(stdout, /5h /);
  assert.doesNotMatch(stdout, /Σ/);
  assert.doesNotMatch(stdout, /API≈/);
});

// --- style presets -------------------------------------------------------
//
// One test per preset, each asserting the thing that makes that preset
// recognisable. The classic tests above are the regression suite for "no
// style set" — these only have to prove the theme reached the renderer.

const styled = (name, fixture, env = {}) =>
  runScript(STATUSLINE, fixture, { CC_USAGE_MONITOR_STYLE: name, ...env });

test('style classic: explicitly naming the default matches the default output', async () => {
  const named = await styled('classic', 'fable.json');
  const implicit = await runScript(STATUSLINE, 'fable.json');
  assert.equal(named.code, 0);
  assert.equal(named.stdout, implicit.stdout);
  assert.match(named.stdout, /ctx ▰▰▱▱▱ 32% \(320k\/1\.0M\)/);
  assert.match(named.stdout, /│/);
});

test('style: an unknown name renders exactly like classic', async () => {
  const bogus = await styled('nonsense', 'fable.json');
  const classic = await runScript(STATUSLINE, 'fable.json');
  assert.equal(bogus.code, 0);
  assert.equal(bogus.stdout, classic.stdout);
});

test('style minimal: no bar glyphs, no ctx detail, percentages survive', async () => {
  const { stdout, code } = await styled('minimal', 'fable.json');
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /▰/);
  assert.doesNotMatch(stdout, /▱/);
  assert.doesNotMatch(stdout, /\(320k\/1\.0M\)/);
  assert.doesNotMatch(stdout, /\(\d+[hdm]/); // no reset countdown either
  assert.match(stdout, /ctx 32%/);
  assert.match(stdout, /5h 18%/);
  assert.match(stdout, /·/);
});

test('style compact: 3-cell shade bars and a pipe separator', async () => {
  const { stdout, code } = await styled('compact', 'fable.json');
  assert.equal(code, 0);
  assert.match(stdout, /ctx █░░ 32%/);
  assert.match(stdout, /5h █░░ 18%/);
  assert.doesNotMatch(stdout, /████/); // never more than 3 cells
  assert.match(stdout, /\|/);
  assert.doesNotMatch(stdout, /\(320k\/1\.0M\)/);
});

test('style detailed: long labels and 8-cell bars', async () => {
  const { stdout, code } = await styled('detailed', 'fable.json');
  assert.equal(code, 0);
  assert.match(stdout, /5-hour/);
  assert.match(stdout, /7-day/);
  assert.match(stdout, /context [▰▱]{8} 32%/);
  assert.match(stdout, /\(320k\/1\.0M\)/);
});

test('style bracket: every bar is wrapped in square brackets', async () => {
  const { stdout, code } = await styled('bracket', 'fable.json');
  assert.equal(code, 0);
  assert.match(stdout, /\[▰/);
  assert.match(stdout, /ctx \[▰▰▱▱▱\] 32%/);
});

test('style ascii: the whole statusline is 7-bit ASCII', async () => {
  const { stdout, code } = await styled('ascii', 'fable.json', {
    CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,turn,session,cost,lines',
  });
  assert.equal(code, 0);
  assert.match(stripAnsi(stdout), /^[\x00-\x7f]*$/);
  assert.match(stdout, /ctx \[##---\] 32%/);
  assert.match(stdout, /\^320k/); // up glyph became ^
});

test('style ascii: colored output is still 7-bit once ANSI is stripped', async () => {
  const { stdout, code } = await styled('ascii', 'high-usage.json', { NO_COLOR: '' });
  assert.equal(code, 0);
  assert.match(stripAnsi(stdout), /^[\x00-\x7f]*$/);
});

test('style ascii: the empty-payload message uses a plain ellipsis', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [STATUSLINE], {
    env: { ...process.env, NO_COLOR: '1', CC_USAGE_MONITOR_STYLE: 'ascii' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stdin.end('');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.match(stdout, /waiting for first turn\.\.\./);
  assert.match(stdout, /^[\x00-\x7f]*$/);
});

test('style dots: round bar glyphs and dot separators', async () => {
  const { stdout, code } = await styled('dots', 'fable.json');
  assert.equal(code, 0);
  assert.match(stdout, /●/);
  assert.match(stdout, /ctx ●●○○○ 32%/);
  assert.match(stdout, /•/);
});

test('style badge: colors on produces background-colored pills', async () => {
  // runScript sets NO_COLOR=1 by default; '' turns colors back on.
  const { stdout, code } = await styled('badge', 'fable.json', { NO_COLOR: '' });
  assert.equal(code, 0);
  assert.match(stdout, /\x1b\[4/);          // some background code
  assert.match(stdout, /\x1b\[30m\x1b\[46m/); // model pill: black on cyan
  assert.doesNotMatch(stdout, /│/);          // pills replace the separator
});

test('style badge: colors off degrades to [ bracketed ] segments', async () => {
  const { stdout, code } = await styled('badge', 'fable.json');
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\x1b\[/);
  assert.match(stdout, /\[ ctx ▰▰▱▱▱ 32% \]/);
  assert.match(stdout, /\[ 5h ▰▱▱▱▱ 18% \]/);
  assert.match(stdout, /\[ Fable 5[\d.]* \]/);
});

test('style emoji: emoji labels replace the word labels', async () => {
  const { stdout, code } = await styled('emoji', 'fable.json', {
    CC_USAGE_MONITOR_SHOW: 'model,ctx,5h,7d,cost',
  });
  assert.equal(code, 0);
  assert.match(stdout, /🧠 ▰▰▱▱▱ 32%/);
  assert.match(stdout, /🤖/);
  assert.match(stdout, /⏱/);
  assert.match(stdout, /📅/);
  assert.doesNotMatch(stdout, /ctx /);
});

test('style mono: colors on yields weight only, never hue', async () => {
  const { stdout, code } = await styled('mono', 'high-usage.json', { NO_COLOR: '' });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\x1b\[(3\d|9\d|4\d|10\d)m/);
  // 95.4% is past the red threshold, so it renders bold.
  assert.match(stdout, /\x1b\[1m/);
  assert.match(stdout, /━/);
});

test('style mono: NO_COLOR strips even the bold/dim weights', async () => {
  const { stdout, code } = await styled('mono', 'high-usage.json');
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /\x1b\[/);
  assert.match(stdout, /5h ━━━━━ 95%/);
});

test('style: barStyle overrides a preset bar but leaves minimal bar-less', async () => {
  const dots = await styled('dots', 'fable.json', { CC_USAGE_MONITOR_BAR_STYLE: 'square' });
  assert.equal(dots.code, 0);
  assert.match(dots.stdout, /ctx ■■□□□ 32%/);

  const minimal = await styled('minimal', 'fable.json', { CC_USAGE_MONITOR_BAR_STYLE: 'square' });
  assert.equal(minimal.code, 0);
  assert.doesNotMatch(minimal.stdout, /■/);
  assert.match(minimal.stdout, /ctx 32%/);
});

test('style: the config file selects a style and the env var overrides it', async () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-style-sl-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ style: 'dots' }));
  try {
    const fromFile = await runScript(STATUSLINE, 'fable.json', { CC_USAGE_MONITOR_CONFIG: tmp });
    assert.equal(fromFile.code, 0);
    assert.match(fromFile.stdout, /●●○○○/);

    const fromEnv = await runScript(STATUSLINE, 'fable.json', {
      CC_USAGE_MONITOR_CONFIG: tmp,
      CC_USAGE_MONITOR_STYLE: 'compact',
    });
    assert.equal(fromEnv.code, 0);
    assert.doesNotMatch(fromEnv.stdout, /●/);
    assert.match(fromEnv.stdout, /█/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('statusline style ascii: stays 7-bit with barStyle=square and marks a computed cost as API=~$', async () => {
  const { stripAnsi } = require('../lib/format');
  const { stdout, code } = await runScript(
    STATUSLINE, 'fable.json',
    { CC_USAGE_MONITOR_STYLE: 'ascii', CC_USAGE_MONITOR_BAR_STYLE: 'square' },
    withFableTranscript
  );
  assert.equal(code, 0);
  assert.match(stripAnsi(stdout), /^[\x00-\x7f]*$/);
  assert.match(stdout, /\[#+-*\]/);
  assert.match(stdout, /API=~\$0\.101/);
  assert.doesNotMatch(stdout, /~~/);
});

test('statusline style badge: session pill keeps a visible delimiter between tokens, lines and cache', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json', { CC_USAGE_MONITOR_STYLE: 'badge' }, withTranscript);
  assert.equal(code, 0);
  assert.match(stdout, /Σ↑892 ↓250 · \+156\/-23 · cache/);
});
