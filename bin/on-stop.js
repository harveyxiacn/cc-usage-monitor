#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor Stop hook.
 *
 * Invoked by Claude Code when an assistant turn finishes. Prints a compact
 * boxed usage summary to stderr so the user sees it inline in the CLI
 * without it leaking into the assistant transcript.
 *
 * Disable by setting CC_USAGE_MONITOR_QUIET=1.
 */

const { readStdinJson, extractUsage } = require('../lib/parse');
const { paint, bar, colorForPercent, timeUntil, formatCost, pct } = require('../lib/format');

async function main() {
  if (process.env.CC_USAGE_MONITOR_QUIET) return;

  const payload = await readStdinJson();
  const u = extractUsage(payload);
  const box = render(u);
  if (box) process.stderr.write(box + '\n');
}

function render(u) {
  // If we have nothing useful to say, say nothing — don't spam empty boxes.
  if (u.fiveH == null && u.sevenD == null && u.cost == null) {
    return '';
  }

  const lines = [];
  const title = paint(' cc-usage-monitor ', 'bold');
  lines.push(boxTop(title));

  if (u.fiveH && u.fiveH.used != null) {
    lines.push(boxLine(formatWindow('5h window', u.fiveH)));
  }
  if (u.sevenD && u.sevenD.used != null) {
    lines.push(boxLine(formatWindow('7d window', u.sevenD)));
  }
  if (u.cost != null || u.model) {
    lines.push(boxLine(formatSession(u)));
  }
  lines.push(boxBottom());
  return lines.join('\n');
}

function formatWindow(label, win) {
  const p = pct(win.used);
  const color = colorForPercent(win.used);
  const barStr = paint(bar(win.used, 12), color);
  const pctStr = paint(`${String(p).padStart(3)}%`, color);
  let text = `${label.padEnd(10)} ${barStr}  ${pctStr}`;
  if (win.resetsAt) {
    const until = timeUntil(win.resetsAt);
    if (until) text += paint(`   resets in ${until}`, 'gray');
  }
  return text;
}

function formatSession(u) {
  const bits = [];
  if (u.cost != null) {
    const c = formatCost(u.cost);
    if (c) bits.push(paint(c, 'magenta'));
  }
  if (u.linesAdded != null || u.linesRemoved != null) {
    const added = u.linesAdded ?? 0;
    const removed = u.linesRemoved ?? 0;
    if (added !== 0 || removed !== 0) {
      bits.push(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')} lines`);
    }
  }
  if (u.model) bits.push(paint(u.model, 'cyan'));
  return `Session     ${bits.join('  •  ')}`;
}

const BOX_INNER_WIDTH = 56;

function boxTop(title) {
  const titleVisible = stripAnsi(title);
  const filler = '─'.repeat(Math.max(0, BOX_INNER_WIDTH - titleVisible.length));
  return paint(`┌─${title}${filler}─┐`, 'gray');
}

function boxBottom() {
  return paint('└' + '─'.repeat(BOX_INNER_WIDTH + 4) + '┘', 'gray');
}

function boxLine(content) {
  const visible = stripAnsi(content);
  const padding = Math.max(0, BOX_INNER_WIDTH - visible.length);
  return paint('│ ', 'gray') + content + ' '.repeat(padding) + paint(' │', 'gray');
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

main().catch(() => {
  // Silent failure — never block Claude Code.
});
