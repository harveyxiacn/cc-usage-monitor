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
 *   NO_COLOR=1 / FORCE_COLOR=0      disable colors
 */

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { paint, bar, colorForPercent, timeUntil, formatCost, formatTokens, pct } = require('../lib/format');

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
  const parts = [];

  if (u.model) parts.push(paint(u.model, 'cyan'));

  const fiveH = renderWindow('5h', u.fiveH);
  if (fiveH) parts.push(fiveH);

  const sevenD = renderWindow('7d', u.sevenD);
  if (sevenD) parts.push(sevenD);

  const ctx = renderContext(u);
  if (ctx) parts.push(ctx);

  const turn = renderTurn(u);
  if (turn) parts.push(turn);

  const sess = renderSession(session);
  if (sess) parts.push(sess);

  if (u.cost != null) {
    const cost = formatCost(u.cost);
    if (cost) parts.push(paint(`API≈${cost}`, 'magenta'));
  }

  if (u.linesAdded != null || u.linesRemoved != null) {
    const added = u.linesAdded ?? 0;
    const removed = u.linesRemoved ?? 0;
    if (added !== 0 || removed !== 0) {
      parts.push(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')}`);
    }
  }

  return parts.length ? parts.join('  ') : paint('cc-usage-monitor: waiting for first turn…', 'gray');
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
  const pctStr = paint(`${pct(u.contextPct)}%`, color);
  let text = `${paint('ctx', 'gray')} ${pctStr}`;
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
  if (hit != null && hit >= 1) {
    text += ' ' + paint(`(${pct(hit)}% cached)`, 'gray');
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
  return parts.join(' ');
}

main().catch(() => {
  // Never break Claude Code — fall back to silent line.
  process.stdout.write('');
});
