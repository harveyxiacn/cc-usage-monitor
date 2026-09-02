#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor statusline.
 *
 * Reads the Claude Code statusline JSON from stdin and prints a single
 * colored line summarising:
 *   - model name
 *   - 5-hour rolling rate-limit usage
 *   - 7-day rolling rate-limit usage
 *   - context-window utilisation
 *   - latest-turn tokens (with cache-hit %)
 *   - session-cumulative tokens (computed from transcript JSONL on disk)
 *   - API-equivalent cost (reported by Claude Code, or computed from the
 *     transcript via lib/pricing when Claude Code omits it)
 *   - lines added / removed this session
 *
 * Configured in settings.json:
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node ${CLAUDE_PLUGIN_ROOT}/bin/statusline.js"
 *   }
 *
 * Environment toggles:
 *   CC_USAGE_MONITOR_SHOW=a,b,c     choose which components appear, in order
 *   CC_USAGE_MONITOR_STYLE=name     pick a style preset (see lib/theme.js);
 *                                   unknown names fall back to `classic`
 *   CC_USAGE_MONITOR_NO_SESSION=1   skip the transcript walk (no Σ segment)
 *   CC_USAGE_MONITOR_WIDTH=N        wrap to a second line if the visible
 *                                   width would exceed N columns. Defaults
 *                                   to process.stdout.columns / $COLUMNS /
 *                                   160 — whichever is found first.
 *   CC_USAGE_MONITOR_TWO_LINE=1     always wrap, regardless of width.
 *   NO_COLOR=1 / FORCE_COLOR=0      disable colors
 *   CC_USAGE_MONITOR_DEBUG=1        print errors to stderr instead of failing
 *                                   silently (developer aid)
 *
 * The same settings can be persisted via /cc-usage-monitor:config — the
 * config file fills in any env var not already set (env always wins).
 */

// Must run before any CC_USAGE_MONITOR_* env var is read below.
require('../lib/config').applyConfigToEnv();

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { sessionCost } = require('../lib/pricing');
const { makePainter, bar, colorForPercent, colorForCacheHit, timeUntil, formatCost, formatTokens, pct, stripAnsi } = require('../lib/format');
const { resolveTheme } = require('../lib/theme');

// Resolved once, right after the config file has been bridged into the env.
// Everything below reads glyphs/widths/labels from it rather than hard-coding
// them, so a preset restyles the whole line without touching the renderers.
const THEME = resolveTheme();
const { paint, paintStatus, badge, sep: SEP } = makePainter(THEME);
const L = THEME.labels;
const G = THEME.glyphs;
const BADGE = THEME.color === 'badge';

// Threshold color -> pill background, for the `badge` theme.
const BG_FOR = { green: 'bgGreen', yellow: 'bgYellow', red: 'bgRed', gray: 'bgGray' };

const ACTIVE_SHOW = process.env.CC_USAGE_MONITOR_SHOW
  ? process.env.CC_USAGE_MONITOR_SHOW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

async function main() {
  const payload = await readStdinJson();
  const u = extractUsage(payload);

  // Walk the transcript on disk for session totals, but only when a visible
  // component actually consumes it (see needsSessionWalk). Bounded by the
  // walker's own 1500ms watchdog and 50 MB cap; never blocks the statusline.
  const session = needsSessionWalk(u)
    ? await sumSessionTokens(payload && payload.transcript_path)
    : null;

  const line = render(u, session);
  process.stdout.write(line);
}

// The transcript walk is an O(transcript) disk read on every turn — skip it
// unless a shown component needs it. The `session` segment always does; `cost`
// needs it only as a fallback when Claude Code didn't already report a cost.
function needsSessionWalk(u) {
  if (process.env.CC_USAGE_MONITOR_NO_SESSION) return false;
  const keys = ACTIVE_SHOW ?? DEFAULT_SHOW;
  if (keys.includes('session')) return true;
  if (keys.includes('cost') && u.cost == null) return true;
  return false;
}

// `turn` is opt-in (via CC_USAGE_MONITOR_SHOW or the config file) — the
// session segment already carries the cumulative picture by default.
const DEFAULT_SHOW = ['model', 'ctx', '5h', '7d', 'session', 'cost'];

// When the line is too long for the terminal we break between the two
// semantic groups: limits/state (line 1) vs. session activity (line 2).
const GROUP = {
  model: 'limits',
  ctx: 'limits',
  '5h': 'limits',
  '7d': 'limits',
  turn: 'activity',
  session: 'activity',
  cost: 'activity',
  lines: 'activity',
};

/** A rendered segment plus the pill background the `badge` theme should use. */
function seg(text, bg) {
  return text ? { text, bg } : null;
}

/**
 * A theme label, ready to be prefixed onto a segment. Themes that blank a
 * label (classic does for model/turn/session/cost) get an empty string, so
 * no stray space is emitted.
 */
function prefix(text) {
  return text ? `${paint(text, 'cyan')} ` : '';
}

/**
 * Bar + percentage for a bounded metric. Bar-less themes (minimal) show the
 * percentage alone — it still carries the threshold color, so the signal
 * survives. `brackets` wrap the bar when the theme asks for them.
 */
function meter(value, color, width) {
  const pctStr = `${pct(value)}%`;
  if (!THEME.bar) return paintStatus(pctStr, color);
  const cells = bar(value, width, THEME.bar);
  const wrapped = THEME.brackets ? THEME.brackets[0] + cells + THEME.brackets[1] : cells;
  return `${paintStatus(wrapped, color)} ${paintStatus(pctStr, color)}`;
}

function renderLines(u) {
  const added = u.linesAdded ?? 0;
  const removed = u.linesRemoved ?? 0;
  if (added === 0 && removed === 0) return null;
  return seg(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')}`, 'bgGray');
}

function renderCost(u, session) {
  // Prefer the cost Claude Code reports; when absent, compute the
  // API-equivalent cost from per-model transcript totals (lib/pricing).
  // Only show a computed figure when every model in the session is priced
  // and the transcript walk wasn't cut short — a partial sum would
  // silently undercount. Computed figures get a ~ to mark the estimate.
  if (u.cost != null) {
    const c = formatCost(u.cost);
    return c ? seg(prefix(L.cost) + paint(`API${G.approx}${c}`, 'magenta'), 'bgMagenta') : null;
  }
  if (!session || session.truncated) return null;
  const computed = sessionCost(session.models);
  if (!computed || !computed.complete) return null;
  const c = formatCost(computed.usd);
  return c ? seg(prefix(L.cost) + paint(`API${G.approx}~${c}`, 'magenta'), 'bgMagenta') : null;
}

const COMPONENTS = {
  model:   (u)          => (u.model ? seg(prefix(L.model) + paint(u.model, 'cyan'), 'bgCyan') : null),
  ctx:     (u)          => renderContext(u),
  '5h':    (u)          => renderWindow(L['5h'], u.fiveH),
  '7d':    (u)          => renderWindow(L['7d'], u.sevenD),
  turn:    (u)          => renderTurn(u),
  session: (u, session) => renderSession(session, u) ?? renderLines(u),
  cost:    (u, session) => renderCost(u, session),
  lines:   (u)          => renderLines(u),
};

function render(u, session) {
  const keys = ACTIVE_SHOW ?? DEFAULT_SHOW;
  const parts = [];
  for (const k of keys) {
    const rendered = COMPONENTS[k]?.(u, session);
    if (!rendered) continue;
    const part = BADGE ? badge(rendered.text, rendered.bg) : rendered.text;
    parts.push({ part, group: GROUP[k] ?? 'activity' });
  }

  if (!parts.length) {
    return paint(`cc-usage-monitor: waiting for first turn${G.ellipsis}`, 'gray');
  }

  // Single line preserves the user's CC_USAGE_MONITOR_SHOW order exactly.
  // The limits/activity split is applied only when actually wrapping.
  const single = parts.map((p) => p.part).join(SEP);
  const limits = parts.filter((p) => p.group === 'limits').map((p) => p.part);
  const activity = parts.filter((p) => p.group !== 'limits').map((p) => p.part);
  if (!limits.length || !activity.length) return single;

  if (twoLineForced()) {
    return limits.join(SEP) + '\n' + activity.join(SEP);
  }
  const width = getTerminalWidth();
  if (width && stripAnsi(single).length > width) {
    return limits.join(SEP) + '\n' + activity.join(SEP);
  }
  return single;
}

function twoLineForced() {
  const v = process.env.CC_USAGE_MONITOR_TWO_LINE;
  return Boolean(v && v !== '0' && v !== 'false');
}

function getTerminalWidth() {
  const env = process.env.CC_USAGE_MONITOR_WIDTH;
  if (env) {
    const n = parseInt(env, 10);
    if (n > 0) return n;
  }
  if (process.stdout && process.stdout.columns) return process.stdout.columns;
  if (process.env.COLUMNS) {
    const n = parseInt(process.env.COLUMNS, 10);
    if (n > 0) return n;
  }
  return 160;
}

function renderWindow(label, win) {
  if (!win || win.used == null) return null;
  const color = colorForPercent(win.used);
  let text = `${prefix(label)}${meter(win.used, color, THEME.barWidth)}`;
  if (THEME.showReset && win.resetsAt) {
    const until = timeUntil(win.resetsAt);
    if (until) text += ` ${paint('(' + until + ')', 'gray')}`;
  }
  return seg(text, BG_FOR[color]);
}

function renderContext(u) {
  if (u.contextPct == null) return null;
  const color = colorForPercent(u.contextPct);
  let text = `${prefix(L.ctx)}${meter(u.contextPct, color, THEME.barWidth)}`;
  if (THEME.showCtxDetail && u.contextSize && u.inputTokens != null) {
    const used = formatTokens(u.inputTokens);
    const total = formatTokens(u.contextSize);
    text += ` ${paint(`(${used}/${total})`, 'gray')}`;
  }
  return seg(text, BG_FOR[color]);
}

function renderTurn(u) {
  const inTok = formatTokens(u.inputTokens);
  const outTok = formatTokens(u.outputTokens);
  if (!inTok && !outTok) return null;
  const parts = [];
  if (inTok) parts.push(`${paint(G.up, 'gray')}${paint(inTok, 'cyan')}`);
  if (outTok) parts.push(`${paint(G.down, 'gray')}${paint(outTok, 'cyan')}`);
  let text = prefix(L.turn) + parts.join(' ');
  // Per-turn cache-hit bar, consistent with the Stop-hook "This turn" row.
  // Suppressed when there's no cache data or nothing was reused (0%).
  const hit = cacheHitPercent(u);
  if (hit != null && hit > 0) {
    text += ` ${prefix(L.cache)}${meter(hit, colorForCacheHit(hit), THEME.barWidth)}`;
  }
  return seg(text, 'bgBlue');
}

function renderSession(session, u) {
  if (!session || session.messageCount === 0) return null;
  const totalIn =
    session.cacheReadTokens + session.cacheCreationTokens + session.inputTokens;
  const totalOut = session.outputTokens;
  if (totalIn === 0 && totalOut === 0) return null;
  const tokenBlock = `${paint(G.sigma + G.up, 'cyan')}${paint(formatTokens(totalIn), 'cyan')} ${paint(G.down, 'cyan')}${paint(formatTokens(totalOut), 'cyan')}`;
  const parts = [prefix(L.session) + tokenBlock];
  const lines = u ? renderLines(u) : null;
  if (lines) parts.push(lines.text);
  // Inside one badge pill the outer separator is a bare space, which would
  // run "↓3.2k" straight into "+12/-3" — keep a visible delimiter there.
  const inner = BADGE ? ` ${paint('·', 'gray')} ` : SEP;
  let text = parts.join(inner);
  if (totalIn > 0) {
    const hit = (session.cacheReadTokens / totalIn) * 100;
    text += `${inner}${prefix(L.cache)}${meter(hit, colorForCacheHit(hit), THEME.barWidth)}`;
  }
  return seg(text, 'bgBlue');
}

main().catch((err) => {
  // Never break Claude Code — fall back to a silent line. Set
  // CC_USAGE_MONITOR_DEBUG=1 to surface the error to stderr while developing.
  if (process.env.CC_USAGE_MONITOR_DEBUG) {
    process.stderr.write(`cc-usage-monitor statusline error: ${(err && err.stack) || err}\n`);
  }
  process.stdout.write('');
});
