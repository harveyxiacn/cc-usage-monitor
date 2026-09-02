'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEMES, THEME_NAMES, resolveTheme, isThemeName, themeHelp, SAMPLE_PAYLOAD } = require('../lib/theme');

const EXPECTED_NAMES = [
  'classic', 'minimal', 'compact', 'detailed', 'bracket',
  'ascii', 'dots', 'badge', 'emoji', 'mono',
];

test('theme: exactly the ten documented presets, in menu order', () => {
  assert.deepEqual(THEME_NAMES, EXPECTED_NAMES);
  assert.equal(Object.keys(THEMES).length, 10);
});

test('theme: every preset resolves to the full documented shape', () => {
  for (const name of THEME_NAMES) {
    const t = resolveTheme({ CC_USAGE_MONITOR_STYLE: name });
    assert.equal(t.name, name, name);
    assert.equal(typeof t.title, 'string', name);
    assert.ok(t.title.length > 0, name);
    assert.equal(typeof t.description, 'string', name);
    assert.ok(t.description.length > 0 && t.description.length <= 70,
      `${name}: description must be 1..70 chars, got ${t.description.length}`);

    // bar is either null (no bars anywhere) or a full glyph triple.
    if (t.bar !== null) {
      for (const key of ['filled', 'empty', 'unknown']) {
        assert.equal(typeof t.bar[key], 'string', `${name}.bar.${key}`);
        assert.ok(t.bar[key].length > 0, `${name}.bar.${key}`);
      }
    }
    assert.ok(Number.isInteger(t.barWidth) && t.barWidth > 0, name);
    assert.ok(Number.isInteger(t.boxBarWidth) && t.boxBarWidth > 0, name);
    assert.ok(t.brackets === null || (Array.isArray(t.brackets) && t.brackets.length === 2), name);
    assert.equal(typeof t.sep, 'string', name);

    for (const key of ['ctx', '5h', '7d', 'cache', 'turn', 'session', 'cost', 'model']) {
      assert.equal(typeof t.labels[key], 'string', `${name}.labels.${key}`);
    }
    assert.equal(typeof t.showReset, 'boolean', name);
    assert.equal(typeof t.showCtxDetail, 'boolean', name);
    assert.ok(['default', 'mono', 'badge'].includes(t.color), `${name}.color`);
    for (const key of ['up', 'down', 'sigma', 'approx']) {
      assert.ok(t.glyphs[key], `${name}.glyphs.${key}`);
    }
    for (const key of ['tl', 'tr', 'bl', 'br', 'h', 'v', 'bullet']) {
      assert.ok(t.box[key], `${name}.box.${key}`);
    }
  }
});

test('theme: unknown, blank and missing names all fall back to classic', () => {
  const classic = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'classic' });
  for (const value of ['nonsense', '', '   ', undefined]) {
    const t = resolveTheme(value === undefined ? {} : { CC_USAGE_MONITOR_STYLE: value });
    assert.deepEqual(t, classic, `expected classic for ${JSON.stringify(value)}`);
  }
});

test('theme: names are matched case-insensitively and trimmed', () => {
  assert.equal(resolveTheme({ CC_USAGE_MONITOR_STYLE: '  DOTS ' }).name, 'dots');
});

test('theme: classic keeps the pre-theme hard-coded values', () => {
  const t = resolveTheme({});
  assert.deepEqual(t.bar, { filled: '▰', empty: '▱', unknown: '─' });
  assert.equal(t.barWidth, 5);
  assert.equal(t.boxBarWidth, 12);
  assert.equal(t.sep, '│');
  assert.equal(t.brackets, null);
  assert.equal(t.showReset, true);
  assert.equal(t.showCtxDetail, true);
  assert.equal(t.color, 'default');
  assert.deepEqual(t.box, { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', bullet: '•' });
});

test('theme: env var wins over a config-provided value', () => {
  // applyConfigToEnv only fills CC_USAGE_MONITOR_STYLE when it is unset, so
  // by the time resolveTheme runs the env var already encodes the winner.
  const { applyConfigToEnv } = require('../lib/config');
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-style-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ style: 'dots' }));
  const prev = process.env.CC_USAGE_MONITOR_CONFIG;
  process.env.CC_USAGE_MONITOR_CONFIG = tmp;
  try {
    // Config alone: the file value is bridged in.
    const fromFile = {};
    applyConfigToEnv(fromFile);
    assert.equal(fromFile.CC_USAGE_MONITOR_STYLE, 'dots');
    assert.equal(resolveTheme(fromFile).name, 'dots');

    // Env already set: the file must not touch it.
    const fromEnv = { CC_USAGE_MONITOR_STYLE: 'ascii' };
    applyConfigToEnv(fromEnv);
    assert.equal(fromEnv.CC_USAGE_MONITOR_STYLE, 'ascii');
    assert.equal(resolveTheme(fromEnv).name, 'ascii');
  } finally {
    if (prev === undefined) delete process.env.CC_USAGE_MONITOR_CONFIG;
    else process.env.CC_USAGE_MONITOR_CONFIG = prev;
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
});

test('theme: BAR_STYLE overrides a preset bar but never revives minimal bars', () => {
  const dots = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'dots', CC_USAGE_MONITOR_BAR_STYLE: 'square' });
  assert.deepEqual(dots.bar, { filled: '■', empty: '□', unknown: '─' });

  // minimal has no bars; an explicit bar style must not re-enable them.
  const minimal = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'minimal', CC_USAGE_MONITOR_BAR_STYLE: 'square' });
  assert.equal(minimal.bar, null);

  // An unknown bar style leaves the preset's own glyphs alone.
  const untouched = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'dots', CC_USAGE_MONITOR_BAR_STYLE: 'neon' });
  assert.deepEqual(untouched.bar, { filled: '●', empty: '○', unknown: '·' });
});

test('theme: resolveTheme returns an isolated copy, not the shared preset', () => {
  const a = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'classic' });
  a.bar.filled = 'X';
  a.labels.ctx = 'X';
  a.box.tl = 'X';
  const b = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'classic' });
  assert.equal(b.bar.filled, '▰');
  assert.equal(b.labels.ctx, 'ctx');
  assert.equal(b.box.tl, '┌');
});

test('theme: ascii preset is 7-bit everywhere it can render', () => {
  const t = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'ascii' });
  const ascii = /^[\x00-\x7f]*$/;
  const pieces = [
    t.bar.filled, t.bar.empty, t.bar.unknown,
    t.brackets[0], t.brackets[1],
    t.sep,
    ...Object.values(t.labels),
    ...Object.values(t.glyphs),
    ...Object.values(t.box),
  ];
  for (const piece of pieces) {
    assert.match(piece, ascii, `non-ASCII in ascii theme: ${JSON.stringify(piece)}`);
  }
});

test('theme: minimal drops bars and both statusline suffixes', () => {
  const t = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'minimal' });
  assert.equal(t.bar, null);
  assert.equal(t.showReset, false);
  assert.equal(t.showCtxDetail, false);
});

test('theme: isThemeName and themeHelp agree with THEME_NAMES', () => {
  assert.equal(isThemeName('mono'), true);
  assert.equal(isThemeName('nope'), false);
  assert.equal(isThemeName(null), false);
  // Inherited Object properties must not count as themes.
  assert.equal(isThemeName('constructor'), false);
  assert.deepEqual(Object.keys(themeHelp()), EXPECTED_NAMES);
});

test('theme: SAMPLE_PAYLOAD is a self-contained preview payload', () => {
  assert.equal(SAMPLE_PAYLOAD.model.id, 'claude-fable-5-1[1m]');
  assert.equal(SAMPLE_PAYLOAD.cost.total_cost_usd, 0.101);
  assert.equal(SAMPLE_PAYLOAD.cost.total_lines_added, 12);
  assert.equal(SAMPLE_PAYLOAD.cost.total_lines_removed, 3);
  assert.equal(SAMPLE_PAYLOAD.rate_limits.five_hour.used_percentage, 18);
  assert.equal(SAMPLE_PAYLOAD.rate_limits.seven_day.used_percentage, 36);
  assert.equal(SAMPLE_PAYLOAD.context_window.used_percentage, 32);
  assert.equal(SAMPLE_PAYLOAD.context_window.context_window_size, 1_000_000);
  // No transcript_path: the preview must never walk a real session.
  assert.equal(SAMPLE_PAYLOAD.transcript_path, undefined);
  // Resets are in the future so the countdown renders instead of "now".
  const now = Date.now() / 1000;
  assert.ok(SAMPLE_PAYLOAD.rate_limits.five_hour.resets_at > now);
  assert.ok(SAMPLE_PAYLOAD.rate_limits.seven_day.resets_at > now);
});

test('resolveTheme: ascii ignores CC_USAGE_MONITOR_BAR_STYLE so its 7-bit guarantee survives a saved barStyle', () => {
  const { resolveTheme } = require('../lib/theme');
  const theme = resolveTheme({ CC_USAGE_MONITOR_STYLE: 'ascii', CC_USAGE_MONITOR_BAR_STYLE: 'square' });
  assert.equal(theme.bar.filled, '#');
  assert.equal(theme.bar.empty, '-');
  // Other presets still honour the override.
  assert.equal(resolveTheme({ CC_USAGE_MONITOR_STYLE: 'dots', CC_USAGE_MONITOR_BAR_STYLE: 'square' }).bar.filled, '■');
});
