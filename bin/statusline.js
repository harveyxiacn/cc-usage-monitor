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
 *   - API-equivalent cost
 *   - lines added / removed this session
 *
 * Configured in settings.json:
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node ${CLAUDE_PLUGIN_ROOT}/bin/statusline.js"
 *   }
 *
 * Environment toggles:
 *   CC_USAGE_MONITOR_NO_SESSION=1   skip the transcript walk (no Σ segment)
 *   CC_USAGE_MONITOR_WIDTH=N        wrap to a second line if the visible
 *                                   width would exceed N columns. Defaults
 *                                   to process.stdout.columns / $COLUMNS /
 *                                   160 — whichever is found first.
 *   CC_USAGE_MONITOR_TWO_LINE=1     always wrap, regardless of width.
 *   NO_COLOR=1 / FORCE_COLOR=0      disable colors
 */

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { paint, bar, colorForPercent, colorForCacheHit, timeUntil, formatCost, formatTokens, pct } = require('../lib/format');

const INLINE_BAR_WIDTH = 5;

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

function render(u, session) {
  // Two semantic groups so that, when the line is too long for the terminal,
  // we can break between them: limits/state (line 1) vs. session activity
  // (line 2). When everything fits, they join into a single line.
  const limits = [];
  const activity = [];

  if (u.model) limits.push(paint(u.model, 'cyan'));

  const fiveH = renderWindow('5h', u.fiveH);
  if (fiveH) limits.push(fiveH);

  const sevenD = renderWindow('7d', u.sevenD);
  if (sevenD) limits.push(sevenD);

  const ctx = renderContext(u);
  if (ctx) limits.push(ctx);

  const turn = renderTurn(u);
  if (turn) activity.push(turn);

  const sess = renderSession(session);
  if (sess) activity.push(sess);

  if (u.cost != null) {
    const cost = formatCost(u.cost);
    if (cost) activity.push(paint(`API≈${cost}`, 'magenta'));
  }

  if (u.linesAdded != null || u.linesRemoved != null) {
    const added = u.linesAdded ?? 0;
    const removed = u.linesRemoved ?? 0;
    if (added !== 0 || removed !== 0) {
      activity.push(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')}`);
    }
  }

  if (!limits.length && !activity.length) {
    return paint('cc-usage-monitor: waiting for first turn…', 'gray');
  }

  const single = [...limits, ...activity].join('  ');
  if (process.env.CC_USAGE_MONITOR_TWO_LINE && limits.length && activity.length) {
    return limits.join('  ') + '\n' + activity.join('  ');
  }

  const width = getTerminalWidth();
  if (width && visibleLength(single) > width && limits.length && activity.length) {
    return limits.join('  ') + '\n' + activity.join('  ');
  }
  return single;
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
  const barStr = paint(bar(win.used), color);
  const pctStr = paint(`${p}%`, color);
  let text = `${label} ${barStr} ${pctStr}`;
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
  let text = `${paint('ctx', 'gray')} ${barStr} ${pctStr}`;
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
  const hit = cacheHitPercent(u);
  if (hit != null) {
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, INLINE_BAR_WIDTH), color);
    const pctStr = paint(`${pct(hit)}%`, color);
    text += ` ${paint('cache', 'gray')} ${barStr} ${pctStr}`;
  }
  return text;
}

function renderSession(session) {
  if (!session || session.messageCount === 0) return null;
  const totalIn =
    session.cacheReadTokens + session.cacheCreationTokens + session.inputTokens;
  const totalOut = session.outputTokens;
  if (totalIn === 0 && totalOut === 0) return null;
  const parts = [];
  parts.push(`${paint('Σ↑', 'gray')}${paint(formatTokens(totalIn), 'cyan')}`);
  parts.push(`${paint('↓', 'gray')}${paint(formatTokens(totalOut), 'cyan')}`);
  let text = parts.join(' ');
  if (totalIn > 0) {
    const hit = (session.cacheReadTokens / totalIn) * 100;
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, INLINE_BAR_WIDTH), color);
    const pctStr = paint(`${pct(hit)}%`, color);
    text += ` ${paint('cache', 'gray')} ${barStr} ${pctStr}`;
  }
  return text;
}

main().catch(() => {
  // Never break Claude Code — fall back to silent line.
  process.stdout.write('');
});
