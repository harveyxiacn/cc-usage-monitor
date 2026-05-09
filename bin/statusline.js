#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor statusline.
 *
 * Reads the Claude Code statusline JSON from stdin and prints a single
 * colored line summarising:
 *   - 5-hour rolling rate-limit usage
 *   - 7-day rolling rate-limit usage
 *   - session cost
 *   - model name
 *   - lines added / removed this session
 *
 * Configured in settings.json:
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node ${CLAUDE_PLUGIN_ROOT}/bin/statusline.js"
 *   }
 */

const { readStdinJson, extractUsage } = require('../lib/parse');
const { paint, bar, colorForPercent, timeUntil, formatCost, pct } = require('../lib/format');

async function main() {
  const payload = await readStdinJson();
  const u = extractUsage(payload);
  const line = render(u);
  process.stdout.write(line);
}

function render(u) {
  const parts = [];

  if (u.model) parts.push(paint(u.model, 'cyan'));

  const fiveH = renderWindow('5h', u.fiveH);
  if (fiveH) parts.push(fiveH);

  const sevenD = renderWindow('7d', u.sevenD);
  if (sevenD) parts.push(sevenD);

  if (u.cost != null) {
    const cost = formatCost(u.cost);
    if (cost) parts.push(paint(cost, 'magenta'));
  }

  if (u.linesAdded != null || u.linesRemoved != null) {
    const added = u.linesAdded ?? 0;
    const removed = u.linesRemoved ?? 0;
    if (added !== 0 || removed !== 0) {
      parts.push(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')}`);
    }
  }

  if (u.contextPct != null && u.contextPct >= 50) {
    parts.push(paint(`ctx ${pct(u.contextPct)}%`, colorForPercent(u.contextPct)));
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

main().catch(() => {
  // Never break Claude Code — fall back to silent line.
  process.stdout.write('');
});
