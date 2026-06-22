#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor Stop hook.
 *
 * Invoked by Claude Code when an assistant turn finishes. Prints a compact
 * boxed usage summary to stderr so the user sees it inline in the CLI
 * without it leaking into the assistant transcript.
 *
 * Disable by setting CC_USAGE_MONITOR_QUIET=1 (or `quiet: true` in the
 * config file written by /cc-usage-monitor:config — env wins on conflict).
 */

// Must run before any CC_USAGE_MONITOR_* env var is read.
require('../lib/config').applyConfigToEnv();

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { sessionCost } = require('../lib/pricing');
const { paint, bar, colorForPercent, colorForCacheHit, timeUntil, formatCost, formatTokens, pct, stripAnsi } = require('../lib/format');

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

  const contents = [];
  if (u.fiveH && u.fiveH.used != null) {
    contents.push(formatWindow('5h window', u.fiveH));
  }
  if (u.sevenD && u.sevenD.used != null) {
    contents.push(formatWindow('7d window', u.sevenD));
  }
  const ctx = formatContextLine(u);
  if (ctx) contents.push(ctx);
  const turn = formatTurnLine(u);
  if (turn) contents.push(turn);
  const sessionLine = formatSessionLine(session);
  if (sessionLine) contents.push(sessionLine);
  const computed = session && !session.truncated ? sessionCost(session.models) : null;
  const models = formatModelsLine(computed);
  if (models) contents.push(models);
  const cost = formatCostLine(u, computed);
  if (cost) contents.push(cost);

  // Size the box to the longest row so a long Session/Models/Cost line
  // widens the whole frame instead of breaking the right border.
  const title = paint(' cc-usage-monitor ', 'bold');
  const innerWidth = Math.max(
    BOX_MIN_INNER_WIDTH,
    ...contents.map((c) => stripAnsi(c).length)
  );
  return [
    boxTop(title, innerWidth),
    ...contents.map((c) => boxLine(c, innerWidth)),
    boxBottom(innerWidth),
  ].join('\n');
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

function formatContextLine(u) {
  if (u.contextPct == null) return null;
  const p = pct(u.contextPct);
  const color = colorForPercent(u.contextPct);
  const barStr = paint(bar(u.contextPct, 12), color);
  const pctStr = paint(`${String(p).padStart(3)}%`, color);
  let text = `${'Context'.padEnd(10)} ${barStr}  ${pctStr}`;
  if (u.contextSize && u.inputTokens != null) {
    const used = formatTokens(u.inputTokens);
    const total = formatTokens(u.contextSize);
    text += paint(`   ${used} of ${total}`, 'gray');
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
  if (hit != null) {
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, 12), color);
    const pctStr = paint(`${String(pct(hit)).padStart(3)}%`, color);
    bits.push(`${barStr} ${pctStr} ${paint('cached', 'gray')}`);
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
    const hit = (session.cacheReadTokens / totalIn) * 100;
    const color = colorForCacheHit(hit);
    const barStr = paint(bar(hit, 12), color);
    const pctStr = paint(`${String(pct(hit)).padStart(3)}%`, color);
    bits.push(`${barStr} ${pctStr} ${paint('cached', 'gray')}`);
  }
  const turnsLabel = session.messageCount === 1 ? '1 turn' : `${session.messageCount} turns`;
  bits.push(paint(turnsLabel, 'gray'));
  return `Session    ${bits.join('  •  ')}`;
}

/**
 * Per-model cost breakdown, computed from transcript token buckets via
 * lib/pricing. Only shown for mixed-model sessions (e.g. main loop on
 * Fable 5, subagents on Haiku) — for single-model sessions the Cost line
 * already tells the whole story.
 */
function formatModelsLine(computed) {
  if (!computed || !computed.complete || computed.perModel.length < 2) return null;
  const bits = computed.perModel.slice(0, 3).map(
    (m) => `${paint(m.name, 'cyan')} ${paint(formatCost(m.usd), 'magenta')}`
  );
  return `Models     ${bits.join('  •  ')}`;
}

function formatCostLine(u, computed) {
  const bits = [];
  if (u.cost != null) {
    const c = formatCost(u.cost);
    if (c) bits.push(paint(`API≈${c}`, 'magenta'));
  } else if (computed && computed.complete) {
    // Claude Code didn't report a cost — show the API-equivalent figure
    // computed from per-model transcript totals and our pricing table.
    const c = formatCost(computed.usd);
    if (c) bits.push(`${paint(`API≈${c}`, 'magenta')} ${paint('(est.)', 'gray')}`);
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

const BOX_MIN_INNER_WIDTH = 60;

function boxTop(title, innerWidth) {
  const titleVisible = stripAnsi(title);
  const filler = '─'.repeat(Math.max(0, innerWidth - titleVisible.length));
  return paint(`┌─${title}${filler}─┐`, 'gray');
}

function boxBottom(innerWidth) {
  // '│ ' + content + ' │' is innerWidth + 4 columns; match it.
  return paint('└' + '─'.repeat(innerWidth + 2) + '┘', 'gray');
}

function boxLine(content, innerWidth) {
  const visible = stripAnsi(content);
  const padding = Math.max(0, innerWidth - visible.length);
  return paint('│ ', 'gray') + content + ' '.repeat(padding) + paint(' │', 'gray');
}

main().catch((err) => {
  // Silent failure — never block Claude Code. Set CC_USAGE_MONITOR_DEBUG=1
  // to surface the error to stderr while developing.
  if (process.env.CC_USAGE_MONITOR_DEBUG) {
    process.stderr.write(`cc-usage-monitor on-stop error: ${(err && err.stack) || err}\n`);
  }
});
