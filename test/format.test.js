'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bar,
  BAR_STYLES,
  makePainter,
  C,
  COLOR_ENABLED,
  timeUntil,
  formatCost,
  formatTokens,
  pct,
  colorForPercent,
  colorForCacheHit,
  stripAnsi,
  paint,
} = require('../lib/format');
const { cacheHitPercent } = require('../lib/parse');

test('bar: 0% renders all empty', () => {
  assert.equal(bar(0, 10), '▱'.repeat(10));
});

test('bar: 100% renders all filled', () => {
  assert.equal(bar(100, 10), '▰'.repeat(10));
});

test('bar: 50% on width 10 is half/half', () => {
  assert.equal(bar(50, 10), '▰'.repeat(5) + '▱'.repeat(5));
});

test('bar: clamps to 0..100', () => {
  assert.equal(bar(-5, 4), '▱'.repeat(4));
  assert.equal(bar(150, 4), '▰'.repeat(4));
});

test('bar: null renders dashes (unknown state)', () => {
  assert.equal(bar(null, 6), '──────');
});

test('timeUntil: future returns "Xd Yh" or "Xh Ym"', () => {
  const now = 1_700_000_000_000; // fixed clock
  // 2 days, 3 hours from now
  const future1 = (now / 1000) + 2 * 86400 + 3 * 3600;
  assert.equal(timeUntil(future1, now), '2d 3h');
  // 4 hours 12 minutes from now
  const future2 = (now / 1000) + 4 * 3600 + 12 * 60;
  assert.equal(timeUntil(future2, now), '4h 12m');
  // 35 minutes from now
  const future3 = (now / 1000) + 35 * 60;
  assert.equal(timeUntil(future3, now), '35m');
});

test('timeUntil: past returns "now"', () => {
  const now = 1_700_000_000_000;
  const past = (now / 1000) - 60;
  assert.equal(timeUntil(past, now), 'now');
});

test('timeUntil: null returns null', () => {
  assert.equal(timeUntil(null), null);
});

test('formatCost: small values use 4 decimals', () => {
  assert.equal(formatCost(0.0034), '$0.0034');
});

test('formatCost: sub-dollar uses 3 decimals', () => {
  assert.equal(formatCost(0.123), '$0.123');
});

test('formatCost: dollar+ uses 2 decimals', () => {
  assert.equal(formatCost(4.875), '$4.88');
});

test('formatCost: zero is $0.00', () => {
  assert.equal(formatCost(0), '$0.00');
});

test('formatCost: null returns null', () => {
  assert.equal(formatCost(null), null);
});

test('pct: rounds to integer', () => {
  assert.equal(pct(23.5), 24);
  assert.equal(pct(23.4), 23);
});

test('colorForPercent: thresholds at 70 and 90', () => {
  assert.equal(colorForPercent(0), 'green');
  assert.equal(colorForPercent(50), 'green');
  assert.equal(colorForPercent(69.9), 'green');
  assert.equal(colorForPercent(70), 'yellow');
  assert.equal(colorForPercent(89.9), 'yellow');
  assert.equal(colorForPercent(90), 'red');
  assert.equal(colorForPercent(100), 'red');
  assert.equal(colorForPercent(null), 'gray');
});

test('formatTokens: small numbers stay as-is', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(42), '42');
  assert.equal(formatTokens(999), '999');
});

test('formatTokens: thousands use 1 decimal under 10k, integer over', () => {
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(9999), '10.0k');
  assert.equal(formatTokens(15500), '16k');
  assert.equal(formatTokens(156000), '156k');
});

test('formatTokens: millions use 1 decimal', () => {
  assert.equal(formatTokens(1_200_000), '1.2M');
  assert.equal(formatTokens(15_500_000), '15.5M');
});

test('formatTokens: null stays null', () => {
  assert.equal(formatTokens(null), null);
});

test('cacheHitPercent: full cache reads', () => {
  const u = { cacheReadTokens: 10000, cacheCreationTokens: 4000, rawInputTokens: 1500 };
  // 10000 / (10000 + 4000 + 1500) = 64.5%
  const hit = cacheHitPercent(u);
  assert.ok(hit > 64 && hit < 65, `expected ~64.5%, got ${hit}`);
});

test('cacheHitPercent: zero cache reads with input present returns 0', () => {
  const u = { cacheReadTokens: 0, cacheCreationTokens: 0, rawInputTokens: 8000 };
  assert.equal(cacheHitPercent(u), 0);
});

test('cacheHitPercent: all-null returns null', () => {
  assert.equal(cacheHitPercent({ cacheReadTokens: null, cacheCreationTokens: null, rawInputTokens: null }), null);
});

test('colorForCacheHit: inverted thresholds at 40 and 70 (higher=better)', () => {
  // Low cache hit = expensive = red
  assert.equal(colorForCacheHit(0), 'red');
  assert.equal(colorForCacheHit(39), 'red');
  // Medium = yellow
  assert.equal(colorForCacheHit(40), 'yellow');
  assert.equal(colorForCacheHit(69), 'yellow');
  // High cache hit = cheap = green
  assert.equal(colorForCacheHit(70), 'green');
  assert.equal(colorForCacheHit(100), 'green');
  assert.equal(colorForCacheHit(null), 'gray');
});

test('stripAnsi: removes color escapes and measures visible width', () => {
  assert.equal(stripAnsi('\x1b[32m+12\x1b[0m'), '+12');
  // Visible length ignores the escape sequences entirely.
  const painted = paint('abc', 'cyan');
  assert.equal(stripAnsi(painted).length, 3);
  // Plain strings pass through unchanged; non-strings are coerced.
  assert.equal(stripAnsi('plain'), 'plain');
  assert.equal(stripAnsi(42), '42');
});

// --- theme support -------------------------------------------------------

test('bar: an explicit style object beats the env-var lookup', () => {
  const prev = process.env.CC_USAGE_MONITOR_BAR_STYLE;
  process.env.CC_USAGE_MONITOR_BAR_STYLE = 'shade';
  try {
    // Explicit wins...
    assert.equal(bar(50, 4, { filled: '#', empty: '-', unknown: '?' }), '##--');
    assert.equal(bar(null, 3, { filled: '#', empty: '-', unknown: '?' }), '???');
    // ...and omitting it keeps the historic env-var behaviour.
    assert.equal(bar(50, 4), '██░░');
  } finally {
    if (prev === undefined) delete process.env.CC_USAGE_MONITOR_BAR_STYLE;
    else process.env.CC_USAGE_MONITOR_BAR_STYLE = prev;
  }
});

test('bar: BAR_STYLES is exported with the documented sets', () => {
  assert.deepEqual(Object.keys(BAR_STYLES), ['block', 'shade', 'square', 'thin', 'ascii']);
  assert.deepEqual(BAR_STYLES.block, { filled: '▰', empty: '▱', unknown: '─' });
});

test('paint: array colors combine codes; single strings are unchanged', () => {
  if (!COLOR_ENABLED) {
    // NO_COLOR in the developer's shell — everything must be a passthrough.
    assert.equal(paint('x', ['black', 'bgGreen']), 'x');
    assert.equal(paint('x', 'cyan'), 'x');
    return;
  }
  assert.equal(paint(' x ', ['black', 'bgGreen']), C.black + C.bgGreen + ' x ' + C.reset);
  assert.equal(paint('x', 'cyan'), C.cyan + 'x' + C.reset);
  // Unknown names inside an array are skipped, not emitted as empty codes.
  assert.equal(paint('x', ['nope', 'bgRed']), C.bgRed + 'x' + C.reset);
  // An array of only unknown names produces no escape at all.
  assert.equal(paint('x', ['nope']), 'x');
  // Legacy quirk preserved: an unknown *string* still appends a reset.
  assert.equal(paint('x', 'nope'), 'x' + C.reset);
});

test('paint: background codes are the standard SGR values', () => {
  assert.equal(C.bgGreen, '\x1b[42m');
  assert.equal(C.bgYellow, '\x1b[43m');
  assert.equal(C.bgRed, '\x1b[41m');
  assert.equal(C.bgCyan, '\x1b[46m');
  assert.equal(C.bgMagenta, '\x1b[45m');
  assert.equal(C.bgBlue, '\x1b[44m');
  assert.equal(C.bgGray, '\x1b[100m');
  assert.equal(C.black, '\x1b[30m');
  assert.equal(C.white, '\x1b[97m');
});

test('makePainter: default paints, mono strips hue, badge builds pills', () => {
  const def = makePainter({ color: 'default', sep: '│' });
  assert.equal(def.mode, 'default');
  assert.equal(stripAnsi(def.sep), ' │ ');
  assert.equal(stripAnsi(def.paintStatus('95%', 'red')), '95%');

  const mono = makePainter({ color: 'mono', sep: '│' });
  const monoOut = [
    mono.paint('label', 'cyan'),
    mono.paint('x', 'gray'),
    mono.paintStatus('95%', 'red'),
    mono.paintStatus('12%', 'green'),
    mono.sep,
  ].join('');
  // Weight (bold/dim) is allowed in mono; hue never is.
  assert.doesNotMatch(monoOut, /\x1b\[(3\d|9\d|4\d|10\d)m/);
  assert.equal(mono.paint('label', 'cyan'), 'label');
  if (COLOR_ENABLED) {
    assert.equal(mono.paintStatus('95%', 'red'), C.bold + '95%' + C.reset);
    assert.equal(mono.paintStatus('12%', 'green'), '12%');
    assert.equal(mono.paint('x', 'gray'), C.dim + 'x' + C.reset);
  }

  const badge = makePainter({ color: 'badge', sep: '' });
  assert.equal(badge.sep, ' ');
  assert.equal(badge.paint('inner', 'cyan'), 'inner'); // the pill carries the color
  if (COLOR_ENABLED) {
    assert.equal(badge.badge('ctx 32%', 'bgGreen'), C.black + C.bgGreen + ' ctx 32% ' + C.reset);
  } else {
    assert.equal(badge.badge('ctx 32%', 'bgGreen'), '[ ctx 32% ]');
  }

  // A surface can opt out of a theme's mode (the Stop-hook box does).
  assert.equal(makePainter({ color: 'badge', sep: '│' }, 'default').mode, 'default');
});
