'use strict';

/**
 * Shared formatters for cc-usage-monitor.
 * No external dependencies. Cross-platform (Windows, macOS, Linux).
 */

const COLOR_ENABLED = computeColorEnabled();

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  black: '\x1b[30m',
  white: '\x1b[97m',
  // Background codes, used by the `badge` theme to draw pill segments.
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
  bgMagenta: '\x1b[45m',
  bgBlue: '\x1b[44m',
  bgGray: '\x1b[100m',
};

function computeColorEnabled() {
  // Claude Code spawns the statusline / Stop hook with stdio piped, so
  // process.stdout.isTTY is always false here — but the terminal that
  // ultimately renders the line interprets ANSI codes. Default to ON, and
  // honour NO_COLOR / CC_USAGE_MONITOR_NO_COLOR / FORCE_COLOR=0 as opt-outs.
  if (process.env.NO_COLOR) return false;
  if (process.env.CC_USAGE_MONITOR_NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0' || process.env.FORCE_COLOR === 'false') return false;
  return true;
}

/**
 * Wrap `text` in one SGR style, or several at once.
 *
 * `color` is normally a key of C ('cyan', 'gray', …). An array combines
 * codes — a badge needs a foreground and a background together, e.g.
 * paint(' 32% ', ['black', 'bgGreen']). Single-string behaviour is
 * deliberately untouched (including the historic quirk that an unknown
 * name still emits a reset) so existing output stays byte-identical.
 */
function paint(text, color) {
  if (!COLOR_ENABLED) return text;
  if (Array.isArray(color)) {
    let codes = '';
    for (const name of color) codes += C[name] || '';
    return codes ? `${codes}${text}${C.reset}` : text;
  }
  return `${C[color] || ''}${text}${C.reset}`;
}

// In `mono` these two pass through untouched — they carry weight, not hue.
const MONO_KEEP = new Set(['bold', 'dim']);

/**
 * Build the painter functions a theme's color mode implies. Both bins call
 * this once at startup and use the returned closures everywhere, so the
 * per-segment hot path is a plain function call with no mode checks.
 *
 *   paint(text, color)              decorative color (labels, glyphs, …)
 *   paintStatus(text, statusColor)  a value carrying a threshold color
 *   badge(text, bgName)             a pill segment (badge mode only)
 *   sep                             ready-to-join separator, spaces included
 *
 * `modeOverride` lets a surface opt out of a theme's mode: the Stop-hook box
 * renders `badge` with ordinary foreground colors, because pills inside a
 * box frame read as noise.
 */
function makePainter(theme, modeOverride) {
  const mode = modeOverride || (theme && theme.color) || 'default';
  const glyph = (theme && theme.sep) || '';

  if (mode === 'mono') {
    // No hue at all: gray becomes dim, a red threshold becomes bold, and
    // everything else renders plain.
    const p = (text, color) => {
      if (color === 'gray') return paint(text, 'dim');
      if (MONO_KEEP.has(color)) return paint(text, color);
      return text;
    };
    return {
      mode,
      paint: p,
      paintStatus: (text, statusColor) => (statusColor === 'red' ? paint(text, 'bold') : text),
      badge: (text) => text,
      sep: glyph ? ` ${p(glyph, 'gray')} ` : ' ',
    };
  }

  if (mode === 'badge') {
    // The pill carries the color, so the text inside it stays plain —
    // otherwise an inner reset would punch a hole in the background.
    const plain = (text) => text;
    return {
      mode,
      paint: plain,
      paintStatus: plain,
      badge: (text, bg) => (COLOR_ENABLED
        ? paint(` ${text} `, ['black', bg || 'bgGray'])
        : `[ ${text} ]`),
      sep: ' ',
    };
  }

  return {
    mode: 'default',
    paint,
    paintStatus: paint,
    badge: (text) => text,
    sep: glyph ? ` ${paint(glyph, 'gray')} ` : ' ',
  };
}

/**
 * Pick a color for a percentage on a usage scale.
 * Lower = greener (more headroom), higher = redder.
 * Used for rate-limit windows, context fill, etc.
 */
function colorForPercent(pct) {
  if (pct == null || Number.isNaN(pct)) return 'gray';
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'yellow';
  return 'green';
}

/**
 * Inverted color: higher cache-hit rate = greener. Used for cache-hit %.
 * 0% means nothing was reused from prompt cache (expensive); 100% means
 * everything was a cache hit (cheap, fast).
 */
function colorForCacheHit(pct) {
  if (pct == null || Number.isNaN(pct)) return 'gray';
  if (pct >= 70) return 'green';
  if (pct >= 40) return 'yellow';
  return 'red';
}

/**
 * Render a percentage as a unicode bar of `width` cells.
 * Uses solid (▰) and faint (▱) so it works in nearly every terminal font.
 */
const BAR_STYLES = {
  block:   { filled: '▰', empty: '▱', unknown: '─' },
  shade:   { filled: '█', empty: '░', unknown: '─' },
  square:  { filled: '■', empty: '□', unknown: '─' },
  thin:    { filled: '━', empty: '╌', unknown: '─' },
  ascii:   { filled: '#', empty: '-', unknown: '-' },
};

/**
 * `style` is an explicit { filled, empty, unknown } set and wins when given
 * (that's how a theme paints its own bars). Without it we fall back to the
 * env-var lookup, which is what every pre-theme caller relies on.
 */
function bar(pct, width = 10, style) {
  const glyphs = style || BAR_STYLES[process.env.CC_USAGE_MONITOR_BAR_STYLE] || BAR_STYLES.block;
  if (pct == null || Number.isNaN(pct)) {
    return glyphs.unknown.repeat(width);
  }
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return glyphs.filled.repeat(filled) + glyphs.empty.repeat(empty);
}

/**
 * Convert a Unix epoch (seconds) into a human "Xh Ym" or "Xd Yh" string
 * representing time-from-now. Returns "now" if reset is in the past.
 */
function timeUntil(epochSeconds, now = Date.now()) {
  if (epochSeconds == null || Number.isNaN(epochSeconds)) return null;
  const diffSec = Math.floor(epochSeconds - now / 1000);
  if (diffSec <= 0) return 'now';
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format a USD cost. Sub-cent values shown to 4 decimals.
 */
function formatCost(usd) {
  if (usd == null || Number.isNaN(usd)) return null;
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Round a percentage to the nearest integer for display, but keep null as null.
 */
function pct(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value);
}

/**
 * Strip ANSI color escapes so the visible (rendered) width of a string can be
 * measured for wrapping and box-drawing. Shared by the statusline and Stop hook.
 */
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Compact a token count: 0..999 -> "999", 1k..999k -> "12.3k", 1M+ -> "1.2M".
 */
function formatTokens(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

module.exports = {
  C,
  paint,
  makePainter,
  colorForPercent,
  colorForCacheHit,
  bar,
  BAR_STYLES,
  timeUntil,
  formatCost,
  formatTokens,
  pct,
  stripAnsi,
  COLOR_ENABLED,
};
