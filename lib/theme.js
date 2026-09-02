'use strict';

/**
 * Style presets ("themes") for cc-usage-monitor.
 *
 * A theme is pure data: glyphs, widths, labels and a color mode. Both
 * surfaces — the statusline (bin/statusline.js) and the Stop-hook box
 * (bin/on-stop.js) — read the same resolved object, so a preset changes
 * both without either bin knowing which preset is active. `labels` and
 * `barWidth` are statusline-only (the box keeps its own row labels and
 * uses `boxBarWidth`); everything else applies to both.
 *
 * Selection order (first hit wins):
 *   1. CC_USAGE_MONITOR_STYLE       environment variable
 *   2. `style` in the config file   (lib/config bridges it into the env var
 *                                    when that variable isn't already set)
 *   3. `classic`                    the original look
 *
 * On top of the chosen preset sit the fine-tuning overrides (see
 * OVERRIDE_ENV below): a handful of orthogonal knobs — separator, bar
 * widths, brackets, the two statusline suffixes and the labels — that
 * adjust one aspect of a preset without leaving it.
 *
 * An unknown name silently falls back to `classic`, and an invalid override
 * is ignored: a typo in a shell profile must never blank out the
 * statusline. The config CLI validates on `set` instead, where there is a
 * human around to read the error.
 *
 * No I/O beyond reading process.env — this module is required on the
 * statusline hot path (it runs on every assistant turn).
 */

const { BAR_STYLES } = require('./format');

// Bar glyph sets that exist only as themes. BAR_STYLES holds the ones the
// standalone `barStyle` setting can select on its own.
const DOT_BAR = { filled: '●', empty: '○', unknown: '·' };

/**
 * The baseline every preset is expressed as a diff against. Its values are
 * exactly what the pre-theme code hard-coded, which is what keeps `classic`
 * byte-identical to previous releases.
 */
const CLASSIC = {
  name: 'classic',
  title: 'Classic',
  description: 'The original look: bars, countdowns and threshold colors',
  bar: BAR_STYLES.block,
  barWidth: 5,
  boxBarWidth: 12,
  brackets: null,
  lockBar: false,
  sep: '│',
  labels: { ctx: 'ctx', '5h': '5h', '7d': '7d', cache: 'cache', turn: '', session: '', cost: '', model: '' },
  showReset: true,
  showCtxDetail: true,
  color: 'default',
  glyphs: { up: '↑', down: '↓', sigma: 'Σ', approx: '≈', ellipsis: '…' },
  box: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', bullet: '•' },
};

/**
 * The ten presets, in menu order. Each is a partial override of CLASSIC;
 * `materialize` fills in the rest. The order is what the preview and the
 * slash command list, so it is part of the UX — `classic` stays first and
 * the loud ones (badge/emoji) sit near the end.
 */
const THEMES = {
  classic: CLASSIC,

  minimal: {
    name: 'minimal',
    title: 'Minimal',
    description: 'No bars at all — just labels and colored percentages',
    // The percentage keeps the threshold color, so the red/yellow/green
    // signal survives even though the bar that usually carries it is gone.
    bar: null,
    sep: '·',
    showReset: false,
    showCtxDetail: false,
  },

  compact: {
    name: 'compact',
    title: 'Compact',
    description: 'Short solid bars, no countdowns — fits narrow terminals',
    bar: BAR_STYLES.shade,
    barWidth: 3,
    boxBarWidth: 8,
    sep: '|',
    showReset: false,
    showCtxDetail: false,
  },

  detailed: {
    name: 'detailed',
    title: 'Detailed',
    description: 'Long bars and spelled-out labels — the most per line',
    barWidth: 8,
    boxBarWidth: 16,
    labels: { ctx: 'context', '5h': '5-hour', '7d': '7-day', cache: 'cache' },
  },

  bracket: {
    name: 'bracket',
    title: 'Bracket',
    description: 'Classic, with every bar wrapped in [brackets]',
    brackets: ['[', ']'],
  },

  ascii: {
    name: 'ascii',
    title: 'ASCII',
    description: 'Pure 7-bit ASCII for terminals that mangle Unicode',
    bar: BAR_STYLES.ascii,
    // The 7-bit promise must survive a saved `barStyle` — that is exactly
    // the setting a user with a Unicode-mangling terminal is likely to have.
    lockBar: true,
    brackets: ['[', ']'],
    sep: '|',
    // `=` for the reported cost so the estimate marker (`~`) stays
    // distinguishable: API=$0.10 (reported) vs API=~$0.10 (computed).
    glyphs: { up: '^', down: 'v', sigma: 'S', approx: '=', ellipsis: '...' },
    box: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', bullet: '*' },
  },

  dots: {
    name: 'dots',
    title: 'Dots',
    description: 'Round bars and dot separators — softer than classic',
    bar: DOT_BAR,
    sep: '•',
  },

  badge: {
    name: 'badge',
    title: 'Badge',
    description: 'Every segment as a colored pill on its own background',
    // Pills already fence the segments, so the separator is a bare space
    // (an empty `sep` renders as a single space) and the trailing suffixes
    // are dropped to keep each badge short enough to scan.
    sep: '',
    color: 'badge',
    showReset: false,
    showCtxDetail: false,
  },

  emoji: {
    name: 'emoji',
    title: 'Emoji',
    description: 'Emoji labels instead of words — model, context, limits',
    labels: { model: '🤖', ctx: '🧠', '5h': '⏱', '7d': '📅', cache: '♻', turn: '⚡', cost: '💰' },
  },

  mono: {
    name: 'mono',
    title: 'Mono',
    description: 'No colors: bold marks anything past the red threshold',
    bar: BAR_STYLES.thin,
    color: 'mono',
  },
};

const THEME_NAMES = Object.keys(THEMES);

/** Expand a preset diff into a complete, independently mutable theme. */
function materialize(preset) {
  // `bar: null` (minimal) is a meaningful value, so only an *absent* key
  // inherits the classic bar.
  const bar = preset.bar === undefined ? CLASSIC.bar : preset.bar;
  return {
    ...CLASSIC,
    ...preset,
    bar: bar ? { ...bar } : null,
    labels: { ...CLASSIC.labels, ...(preset.labels || {}) },
    glyphs: { ...CLASSIC.glyphs, ...(preset.glyphs || {}) },
    box: { ...CLASSIC.box, ...(preset.box || {}) },
  };
}

/* ---------------------------------------------------------------------- *
 * Fine-tuning overrides
 *
 * A preset is a whole look; these seven knobs adjust one aspect of it
 * without leaving the preset. They layer on top of the resolved preset
 * (after the `barStyle` glyph override) and follow the same precedence rule
 * as everything else: the env var wins, and lib/config fills it in from the
 * config file only when it isn't already set.
 *
 * Every parser answers `null` for "absent or invalid", which the caller
 * reads as "leave the preset alone". The silence is deliberate: these
 * values arrive from a shell profile or a hand-edited JSON file, where a
 * typo must never blank out the statusline — `bin/config.js set` validates
 * loudly instead, where a human is there to read the error.
 * ---------------------------------------------------------------------- */

/** config key -> environment variable, in the order the config CLI lists them. */
const OVERRIDE_ENV = {
  sep: 'CC_USAGE_MONITOR_SEP',
  barWidth: 'CC_USAGE_MONITOR_BAR_WIDTH',
  boxBarWidth: 'CC_USAGE_MONITOR_BOX_BAR_WIDTH',
  brackets: 'CC_USAGE_MONITOR_BRACKETS',
  showReset: 'CC_USAGE_MONITOR_SHOW_RESET',
  showCtxDetail: 'CC_USAGE_MONITOR_CTX_DETAIL',
  labels: 'CC_USAGE_MONITOR_LABELS',
};

/** The statusline label slots a `labels` override may address. */
const LABEL_KEYS = ['ctx', '5h', '7d', 'cache', 'turn', 'session', 'cost', 'model'];

// Upper bounds, picked so a bar can never swallow a line or a box.
const MAX_BAR_WIDTH = 20;
const MAX_BOX_BAR_WIDTH = 40;

/** The `brackets` value that means "no wrapping at all". */
const NO_BRACKETS = 'none';

/**
 * A separator glyph: 1-3 characters, at least one of them visible. The
 * length cap keeps a stray word from being pasted between every segment;
 * the blank check keeps an accidental space from erasing the separator
 * (a preset that wants that says `sep: ''` itself).
 */
function parseSepOverride(value) {
  if (value == null) return null;
  const s = String(value);
  const length = Array.from(s).length; // count code points, not UTF-16 units
  if (length < 1 || length > 3 || !s.trim()) return null;
  return s;
}

/** A bar width: a plain integer in 1..max. Anything else is ignored. */
function parseWidthOverride(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= max ? n : null;
}

/**
 * Bar wrapping: exactly two characters (`[]`, `()`, `<>`, `「」`, …) split
 * into an open/close pair, or the word `none` to drop a preset's wrapping.
 * Returns NO_BRACKETS for the latter so the caller can tell "remove them"
 * from "nothing was said".
 */
function parseBracketsOverride(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.toLowerCase() === NO_BRACKETS) return NO_BRACKETS;
  const chars = Array.from(s);
  return chars.length === 2 ? [chars[0], chars[1]] : null;
}

/**
 * A boolean toggle. `0`/`false` turn the feature off, any other non-blank
 * value turns it on — matching how the older CC_USAGE_MONITOR_* flags read.
 * Blank means "not set", so an exported-but-empty variable is a no-op.
 */
function parseBoolOverride(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  return !(s === '0' || s === 'false');
}

/**
 * Labels as `key=value,key=value`. Split on the *first* `=` so a label may
 * contain one; an empty value is meaningful (it hides that label). Unknown
 * keys and pairs without an `=` are skipped, so one bad entry can't cost
 * the user the rest of the list.
 */
function parseLabelsOverride(value) {
  if (value == null) return null;
  const out = {};
  let found = false;
  for (const piece of String(value).split(',')) {
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    const key = piece.slice(0, eq).trim();
    if (!LABEL_KEYS.includes(key)) continue;
    out[key] = piece.slice(eq + 1).trim();
    found = true;
  }
  return found ? out : null;
}

/** Layer the overrides onto an already-materialized theme, in place. */
function applyOverrides(theme, env) {
  const sep = parseSepOverride(env[OVERRIDE_ENV.sep]);
  if (sep !== null) theme.sep = sep;

  // Bar geometry is meaningless without bars: on `minimal` these are silent
  // no-ops, exactly like `barStyle` — an override fine-tunes a bar, it
  // never brings one back.
  if (theme.bar) {
    const barWidth = parseWidthOverride(env[OVERRIDE_ENV.barWidth], MAX_BAR_WIDTH);
    if (barWidth !== null) theme.barWidth = barWidth;

    const boxBarWidth = parseWidthOverride(env[OVERRIDE_ENV.boxBarWidth], MAX_BOX_BAR_WIDTH);
    if (boxBarWidth !== null) theme.boxBarWidth = boxBarWidth;

    const brackets = parseBracketsOverride(env[OVERRIDE_ENV.brackets]);
    if (brackets === NO_BRACKETS) theme.brackets = null;
    else if (brackets) theme.brackets = brackets;
  }

  const showReset = parseBoolOverride(env[OVERRIDE_ENV.showReset]);
  if (showReset !== null) theme.showReset = showReset;

  const showCtxDetail = parseBoolOverride(env[OVERRIDE_ENV.showCtxDetail]);
  if (showCtxDetail !== null) theme.showCtxDetail = showCtxDetail;

  // Merged key by key: renaming `ctx` must not cost the preset its `5h`.
  const labels = parseLabelsOverride(env[OVERRIDE_ENV.labels]);
  if (labels) Object.assign(theme.labels, labels);

  return theme;
}

/**
 * Resolve the active theme from the environment.
 *
 * `CC_USAGE_MONITOR_BAR_STYLE` (set directly, or bridged from the
 * `barStyle` config key) overrides the preset's bar glyphs: an explicit
 * setting should beat a preset's default. It never *re-enables* bars on a
 * bar-less preset like `minimal`, and it is ignored by presets that lock
 * their glyphs (`ascii`, whose whole point is 7-bit output) — when the
 * user asks for both, the more specific answer (the theme) wins.
 *
 * The fine-tuning overrides go on last and apply to *every* preset, `ascii`
 * included: the user typed them deliberately, so explicit beats preset. The
 * locked bar glyphs are the single exception, for the reason above.
 */
function resolveTheme(env = process.env) {
  const requested = String(env.CC_USAGE_MONITOR_STYLE || '').trim().toLowerCase();
  const theme = materialize(THEMES[requested] || THEMES.classic);
  const override = BAR_STYLES[env.CC_USAGE_MONITOR_BAR_STYLE];
  if (override && theme.bar && !theme.lockBar) theme.bar = { ...override };
  return applyOverrides(theme, env);
}

/** True when `name` is one of the ten presets. */
function isThemeName(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(THEMES, name);
}

/** { name: description } for every preset, in menu order. */
function themeHelp() {
  const out = {};
  for (const name of THEME_NAMES) out[name] = THEMES[name].description;
  return out;
}

/**
 * A representative statusline payload for `bin/config.js preview`.
 *
 * Mirrors test/fixtures/fable.json, but carries a reported cost so the
 * preview never has to walk a transcript, and uses *relative* reset
 * timestamps so the countdown reads like a real session ("2h 13m") instead
 * of the five-digit day count a fixed far-future epoch would produce.
 */
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const SAMPLE_PAYLOAD = {
  cwd: '/home/example/project',
  session_id: 'cc-usage-monitor-preview',
  model: { id: 'claude-fable-5-1[1m]' },
  workspace: {
    current_dir: '/home/example/project',
    project_dir: '/home/example/project',
  },
  cost: {
    total_cost_usd: 0.101,
    total_duration_ms: 60000,
    total_api_duration_ms: 4100,
    total_lines_added: 12,
    total_lines_removed: 3,
  },
  context_window: {
    total_input_tokens: 320000,
    total_output_tokens: 2400,
    context_window_size: 1000000,
    used_percentage: 32,
    remaining_percentage: 68,
    current_usage: {
      input_tokens: 1000,
      output_tokens: 2400,
      cache_creation_input_tokens: 9000,
      cache_read_input_tokens: 310000,
    },
  },
  rate_limits: {
    five_hour: { used_percentage: 18, resets_at: NOW_SECONDS + 2 * 3600 + 13 * 60 },
    seven_day: { used_percentage: 36, resets_at: NOW_SECONDS + 3 * 86400 + 5 * 3600 },
  },
  version: '2.2.10',
};

module.exports = {
  THEMES,
  THEME_NAMES,
  resolveTheme,
  isThemeName,
  themeHelp,
  SAMPLE_PAYLOAD,
  // Fine-tuning overrides: the shared vocabulary lib/config and bin/config
  // validate against, plus the parsers themselves so both surfaces agree on
  // what counts as valid.
  OVERRIDE_ENV,
  LABEL_KEYS,
  MAX_BAR_WIDTH,
  MAX_BOX_BAR_WIDTH,
  NO_BRACKETS,
  parseSepOverride,
  parseWidthOverride,
  parseBracketsOverride,
  parseBoolOverride,
  parseLabelsOverride,
};
