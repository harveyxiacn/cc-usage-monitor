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

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { paint, bar, colorForPercent, timeUntil, formatCost, formatTokens, pct } = require('../lib/format');

async function main() {
  if (process.env.CC_USAGE_MONITOR_QUIET) return;

  const payload = await readStdinJson();
  const u = extractUsage(payload);
  const session = await sumSessionTokens(payload && payload.transcript_path);
  const box = render(u, session);
  if (box) process.stderr.write(box + '\n');
}

function render(u, session) {
  // If we have nothing useful to say, say nothing — don't spam empty boxes.
  if (
    u.fiveH == null
    && u.sevenD == null
    && u.cost == null
    && u.inputTokens == null
    && u.outputTokens == null
    && (!session || session.messageCount === 0)
  ) {
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
  const turn = formatTurnLine(u);
  if (turn) lines.push(boxLine(turn));
  const sessionLine = formatSessionLine(session);
  if (sessionLine) lines.push(boxLine(sessionLine));
  const cost = formatCostLine(u);
  if (cost) lines.push(boxLine(cost));

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

function formatTurnLine(u) {
  const inTok = formatTokens(u.inputTokens);
  const outTok = formatTokens(u.outputTokens);
  if (!inTok && !outTok) return null;
  const bits = [];
  if (inTok) bits.push(`${paint('↑', 'gray')} ${paint(inTok, 'cyan')}`);
  if (outTok) bits.push(`${paint('↓', 'gray')} ${paint(outTok, 'cyan')}`);
  const hit = cacheHitPercent(u);
  if (hit != null && hit >= 1) {
    bits.push(paint(`${pct(hit)}% cached`, 'green'));
  }
  return `This turn  ${bits.join('  •  ')}`;
}

function formatSessionLine(session) {
  if (!session || session.messageCount === 0) return null;
  const totalIn =
    session.cacheReadTokens + session.cacheCreationTokens + session.inputTokens;
  const totalOut = session.outputTokens;
  if (totalIn === 0 && totalOut === 0) return null;
  const bits = [];
  bits.push(`${paint('↑', 'gray')} ${paint(formatTokens(totalIn), 'cyan')}`);
  bits.push(`${paint('↓', 'gray')} ${paint(formatTokens(totalOut), 'cyan')}`);
  if (totalIn > 0) {
    const hitPct = (session.cacheReadTokens / totalIn) * 100;
    if (hitPct >= 1) {
      bits.push(paint(`${pct(hitPct)}% cached`, 'green'));
    }
  }
  const turnsLabel = session.messageCount === 1 ? '1 turn' : `${session.messageCount} turns`;
  bits.push(paint(turnsLabel, 'gray'));
  return `Session    ${bits.join('  •  ')}`;
}

function formatCostLine(u) {
  const bits = [];
  if (u.cost != null) {
    const c = formatCost(u.cost);
    if (c) bits.push(paint(`API≈${c}`, 'magenta'));
  }
  if (u.linesAdded != null || u.linesRemoved != null) {
    const added = u.linesAdded ?? 0;
    const removed = u.linesRemoved ?? 0;
    if (added !== 0 || removed !== 0) {
      bits.push(`${paint('+' + added, 'green')}/${paint('-' + removed, 'red')} lines`);
    }
  }
  if (u.model) bits.push(paint(u.model, 'cyan'));
  if (bits.length === 0) return null;
  return `Cost       ${bits.join('  •  ')}`;
}

const BOX_INNER_WIDTH = 60;

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
