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
 *   CC_USAGE_MONITOR_NO_SESSION=1   skip the transcript walk (no Σ segment)
 *   CC_USAGE_MONITOR_WIDTH=N        wrap to a second line if the visible
 *                                   width would exceed N columns. Defaults
 *                                   to process.stdout.columns / $COLUMNS /
 *                                   160 — whichever is found first.
 *   CC_USAGE_MONITOR_TWO_LINE=1     always wrap, regardless of width.
 *   NO_COLOR=1 / FORCE_COLOR=0      disable colors
 *
 * The same settings can be persisted via /cc-usage-monitor:config — the
 * config file fills in any env var not already set (env always wins).
 */

// Must run before any CC_USAGE_MONITOR_* env var is read below.
require('../lib/config').applyConfigToEnv();

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { sessionCost } = require('../lib/pricing');
const { paint, bar, colorForPercent, colorForCacheHit, timeUntil, formatCost, formatTokens, pct } = require('../lib/format');

const INLINE_BAR_WIDTH = 5;
const SEP = ` ${paint('│', 'gray')} `;
const ACTIVE_SHOW = process.env.CC_USAGE_MONITOR_SHOW
  ? process.env.CC_USAGE_MONITOR_SHOW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

async function main() {
  const payload = await readStdinJson();
  const u = extractUsage(payload);

  // Walk the transcript on disk for session totals. Bounded by the walker's
  // own 1500ms watchdog and 50 MB cap; never blocks the statusline.
  const session = process.env.CC_USAGE_MONITOR_NO_SESSION
    ? null
    : await sumSessionTokens(payload && payload.transcript_path);

  const line = render(u, session);
  process.stdout.write(line);
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

function renderLines(u) {
  const added = u.linesAdded ?? 0;
  const removed = u.linesRemoved ?? 0;
  if (added === 0 && removed === 0) return null;
  return `${paint('+' + added, 'green')}/${paint('-' + removed, 'red')}`;
}

function renderCost(u, session) {
  // Prefer the cost Claude Code reports; when absent, compute the
  // API-equivalent cost from per-model transcript totals (lib/pricing).
  // Only show a computed figure when every model in the session is priced
  // and the transcript walk wasn't cut short — a partial sum would
  // silently undercount. Computed figures get a ~ to mark the estimate.
  if (u.cost != null) {
    const c = formatCost(u.cost);
    return c ? paint(`API≈${c}`, 'magenta') : null;
  }
  if (!session || session.truncated) return null;
  const computed = sessionCost(session.models);
  if (!computed || !computed.complete) return null;
  const c = formatCost(computed.usd);
  return c ? paint(`API≈~${c}`, 'magenta') : null;
}

const COMPONENTS = {
  model:   (u)          => u.model ? paint(u.model, 'cyan') : null,
  ctx:     (u)          => renderContext(u),
  '5h':    (u)          => renderWindow('5h', u.fiveH),
  '7d':    (u)          => renderWindow('7d', u.sevenD),
  turn:    (u)          => renderTurn(u),
  session: (u, session) => renderSession(session, u) ?? renderLines(u),
  cost:    (u, session) => renderCost(u, session),
  lines:   (u)          => renderLines(u),
};

function render(u, session) {
  const keys = ACTIVE_SHOW ?? DEFAULT_SHOW;
  const parts = [];
  for (const k of keys) {
    const part = COMPONENTS[k]?.(u, session);
    if (part) parts.push({ part, group: GROUP[k] ?? 'activity' });
  }

  if (!parts.length) {
    return paint('cc-usage-monitor: waiting for first turn…', 'gray');
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
  if (width && visibleLength(single) > width) {
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

function visibleLength(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function renderWindow(label, win) {
  if (!win || win.used == null) return null;
  const p = pct(win.used);
  const color = colorForPercent(win.used);
  const barStr = paint(bar(win.used, INLINE_BAR_WIDTH), color);
  const pctStr = paint(`${p}%`, color);
  let text = `${paint(label, 'cyan')} ${barStr} ${pctStr}`;
  if (win.resetsAt) {
    const until = timeUntil(win.resetsAt);
    if (until) text += ` ${paint('(' + until + ')', 'gray')}`;
  }
  return text;
}

function renderContext(u) {
  if (u.contextPct == null) return null;
  const color = colorForPercent(u.contextPct);
  const barStr = paint(bar(u.contextPct, INLINE_BAR_WIDTH), color);
  const pctStr = paint(`${pct(u.contextPct)}%`, color);
  let text = `${paint('ctx', 'cyan')} ${barStr} ${pctStr}`;
  if (u.contextSize && u.inputTokens != null) {
    const used = formatTokens(u.inputTokens);
    const total = formatTokens(u.contextSize);
    text += ` ${paint(`(${used}/${total})`, 'gray')}`;
  }
  return text;
}

function renderTurn(u) {
  const inTok = formatTokens(u.inputTokens);
  const outTok = formatTokens(u.outputTokens);
  if (!inTok && !outTok) return null;
  const parts = [];
  if (inTok) parts.push(`${paint('↑', 'gray')}${paint(inTok, 'cyan')}`);
  if (outTok) parts.push(`${paint('↓', 'gray')}${paint(outTok, 'cyan')}`);
  let text = parts.join(' ');
  // Per-turn cache-hit bar, consistent with the Stop-hook "This turn" row.
  // Suppressed when there's no cache data or nothing was reused (0%).
  const hit = cacheHitPercent(u);
  if (hit != null && hit > 0) {
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, INLINE_BAR_WIDTH), color);
    const pctStr = paint(`${pct(hit)}%`, color);
    text += ` ${paint('cache', 'cyan')} ${barStr} ${pctStr}`;
  }
  return text;
}

function renderSession(session, u) {
  if (!session || session.messageCount === 0) return null;
  const totalIn =
    session.cacheReadTokens + session.cacheCreationTokens + session.inputTokens;
  const totalOut = session.outputTokens;
  if (totalIn === 0 && totalOut === 0) return null;
  const tokenBlock = `${paint('Σ↑', 'cyan')}${paint(formatTokens(totalIn), 'cyan')} ${paint('↓', 'cyan')}${paint(formatTokens(totalOut), 'cyan')}`;
  const parts = [tokenBlock];
  const lines = u ? renderLines(u) : null;
  if (lines) parts.push(lines);
  let text = parts.join(SEP);
  if (totalIn > 0) {
    const hit = (session.cacheReadTokens / totalIn) * 100;
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, INLINE_BAR_WIDTH), color);
    const pctStr = paint(`${pct(hit)}%`, color);
    text += `${SEP}${paint('cache', 'cyan')} ${barStr} ${pctStr}`;
  }
  return text;
}

main().catch(() => {
  // Never break Claude Code — fall back to silent line.
  process.stdout.write('');
});
