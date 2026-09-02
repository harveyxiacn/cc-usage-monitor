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
 * The box follows the same style preset as the statusline
 * (CC_USAGE_MONITOR_STYLE / the `style` config key — see lib/theme.js), and
 * the same fine-tuning overrides: CC_USAGE_MONITOR_BOX_BAR_WIDTH sizes the
 * bars in here (1-40) and CC_USAGE_MONITOR_BRACKETS wraps them.
 */

// Must run before any CC_USAGE_MONITOR_* env var is read.
require('../lib/config').applyConfigToEnv();

const { readStdinJson, extractUsage, cacheHitPercent } = require('../lib/parse');
const { sumSessionTokens } = require('../lib/transcript');
const { sessionCost } = require('../lib/pricing');
const { makePainter, bar, colorForPercent, colorForCacheHit, timeUntil, formatCost, formatTokens, pct, stripAnsi } = require('../lib/format');
const { resolveTheme } = require('../lib/theme');

const THEME = resolveTheme();
// `badge` is a statusline idea: pills inside a box frame just read as noise,
// and their backgrounds would fight the border. Render it like `classic`
// here — every other mode (including `mono`) carries over unchanged.
const { paint, paintStatus } = makePainter(THEME, THEME.color === 'badge' ? 'default' : undefined);
const G = THEME.glyphs;
const BOX = THEME.box;
// Separator between the bits of a row. Unpainted, like the rest of the frame.
const BULLET = `  ${BOX.bullet}  `;

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

/**
 * Bar + right-aligned percentage for one bounded metric.
 *
 * `gap` is the spacing the caller wants between them — the window/context
 * rows line their percentages up in a column (two spaces), the inline bits
 * of the turn/session rows use one. Bar-less themes (minimal) drop the bar
 * *and* the gap, leaving the colored percentage to carry the signal.
 */
function boxMeter(value, color, gap, aligned = false) {
  const pctStr = `${String(pct(value)).padStart(3)}%`;
  // Without a bar the left pad only helps in the column-aligned rows
  // (5h / 7d / Context); inline after a bullet it reads as a stray gap.
  if (!THEME.bar) return paintStatus(aligned ? pctStr : pctStr.trimStart(), color);
  const cells = bar(value, THEME.boxBarWidth, THEME.bar);
  const wrapped = THEME.brackets ? THEME.brackets[0] + cells + THEME.brackets[1] : cells;
  return `${paintStatus(wrapped, color)}${gap}${paintStatus(pctStr, color)}`;
}

function formatWindow(label, win) {
  const color = colorForPercent(win.used);
  let text = `${label.padEnd(10)} ${boxMeter(win.used, color, '  ', true)}`;
  if (win.resetsAt) {
    const until = timeUntil(win.resetsAt);
    if (until) text += paint(`   resets in ${until}`, 'gray');
  }
  return text;
}

function formatContextLine(u) {
  if (u.contextPct == null) return null;
  const color = colorForPercent(u.contextPct);
  let text = `${'Context'.padEnd(10)} ${boxMeter(u.contextPct, color, '  ', true)}`;
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
  if (inTok) bits.push(`${paint(G.up, 'gray')} ${paint(inTok, 'cyan')}`);
  if (outTok) bits.push(`${paint(G.down, 'gray')} ${paint(outTok, 'cyan')}`);
  const hit = cacheHitPercent(u);
  if (hit != null) {
    bits.push(`${boxMeter(hit, colorForCacheHit(hit), ' ')} ${paint('cached', 'gray')}`);
  }
  return `This turn  ${bits.join(BULLET)}`;
}

function formatSessionLine(session) {
  if (!session || session.messageCount === 0) return null;
  const totalIn =
    session.cacheReadTokens + session.cacheCreationTokens + session.inputTokens;
  const totalOut = session.outputTokens;
  if (totalIn === 0 && totalOut === 0) return null;
  const bits = [];
  bits.push(`${paint(G.up, 'gray')} ${paint(formatTokens(totalIn), 'cyan')}`);
  bits.push(`${paint(G.down, 'gray')} ${paint(formatTokens(totalOut), 'cyan')}`);
  if (totalIn > 0) {
    const hit = (session.cacheReadTokens / totalIn) * 100;
    bits.push(`${boxMeter(hit, colorForCacheHit(hit), ' ')} ${paint('cached', 'gray')}`);
  }
  const turnsLabel = session.messageCount === 1 ? '1 turn' : `${session.messageCount} turns`;
  bits.push(paint(turnsLabel, 'gray'));
  return `Session    ${bits.join(BULLET)}`;
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
  return `Models     ${bits.join(BULLET)}`;
}

function formatCostLine(u, computed) {
  const bits = [];
  if (u.cost != null) {
    const c = formatCost(u.cost);
    if (c) bits.push(paint(`API${G.approx}${c}`, 'magenta'));
  } else if (computed && computed.complete) {
    // Claude Code didn't report a cost — show the API-equivalent figure
    // computed from per-model transcript totals and our pricing table.
    const c = formatCost(computed.usd);
    if (c) bits.push(`${paint(`API${G.approx}${c}`, 'magenta')} ${paint('(est.)', 'gray')}`);
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
  return `Cost       ${bits.join(BULLET)}`;
}

const BOX_MIN_INNER_WIDTH = 60;

function boxTop(title, innerWidth) {
  const titleVisible = stripAnsi(title);
  const filler = BOX.h.repeat(Math.max(0, innerWidth - titleVisible.length));
  return paint(`${BOX.tl}${BOX.h}${title}${filler}${BOX.h}${BOX.tr}`, 'gray');
}

function boxBottom(innerWidth) {
  // '│ ' + content + ' │' is innerWidth + 4 columns; match it.
  return paint(BOX.bl + BOX.h.repeat(innerWidth + 2) + BOX.br, 'gray');
}

function boxLine(content, innerWidth) {
  const visible = stripAnsi(content);
  const padding = Math.max(0, innerWidth - visible.length);
  return paint(`${BOX.v} `, 'gray') + content + ' '.repeat(padding) + paint(` ${BOX.v}`, 'gray');
}

main().catch((err) => {
  // Silent failure — never block Claude Code. Set CC_USAGE_MONITOR_DEBUG=1
  // to surface the error to stderr while developing.
  if (process.env.CC_USAGE_MONITOR_DEBUG) {
    process.stderr.write(`cc-usage-monitor on-stop error: ${(err && err.stack) || err}\n`);
  }
});
