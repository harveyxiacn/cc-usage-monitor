#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor config CLI — backs the /cc-usage-monitor:config slash
 * command, and works standalone:
 *
 *   node bin/config.js get
 *   node bin/config.js set show model,ctx,5h,7d,cost
 *   node bin/config.js set style dots
 *   node bin/config.js set barStyle shade
 *   node bin/config.js set twoLine true | set width 120 | set quiet false
 *   node bin/config.js reset [key]
 *   node bin/config.js preview [style]
 *
 * Fine-tuning on top of the chosen style (see lib/theme.js):
 *   node bin/config.js set sep »
 *   node bin/config.js set barWidth 8 | set boxBarWidth 16
 *   node bin/config.js set brackets [] | set brackets none
 *   node bin/config.js set showReset false | set showCtxDetail false
 *   node bin/config.js set labels ctx=context,5h=5-hour   (merges; `ctx=`
 *                                                          blanks a label)
 *
 * `get` prints JSON: current saved config, the config file path, the valid
 * values, and `effective` — the theme that would actually render right now,
 * env vars and overrides included — so an agent can render a checklist
 * without guessing.
 * `preview` renders a sample statusline in every style so the user can pick
 * one by eye instead of by name.
 * Exits non-zero with a message on stderr for invalid input.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  VALID_COMPONENTS,
  VALID_BAR_STYLES,
  VALID_STYLES,
  OVERRIDE_KEYS,
  configPath,
  loadConfig,
  saveConfig,
  applyConfigToEnv,
} = require('../lib/config');
const {
  themeHelp,
  resolveTheme,
  SAMPLE_PAYLOAD,
  LABEL_KEYS,
  MAX_BAR_WIDTH,
  MAX_BOX_BAR_WIDTH,
  NO_BRACKETS,
  parseSepOverride,
  parseWidthOverride,
  parseBracketsOverride,
} = require('../lib/theme');

/** Every key `set` accepts, in the order the help text lists them. */
const SETTABLE_KEYS = [
  'show', 'style', 'barStyle', 'twoLine', 'width', 'quiet', 'noSession',
  ...OVERRIDE_KEYS,
];

const OVERRIDE_HELP = {
  sep: 'Separator between statusline segments — 1-3 characters (e.g. » or ::)',
  barWidth: `Statusline bar cells — an integer from 1 to ${MAX_BAR_WIDTH}`,
  boxBarWidth: `Stop-hook box bar cells — an integer from 1 to ${MAX_BOX_BAR_WIDTH}`,
  brackets: 'Wrap every bar — exactly 2 characters ([], (), <>, {}, 「」) or "none"',
  showReset: 'Show the rate-limit reset countdown in the statusline — true|false',
  showCtxDetail: 'Show the (used/total) suffix after the context bar — true|false',
  labels: `Rename statusline labels — key=value,… over ${LABEL_KEYS.join(', ')} (empty value hides one)`,
};

const COMPONENT_HELP = {
  model: 'Model name (e.g. "Fable 5.1")',
  ctx: 'Context-window bar + % + (used/total)',
  '5h': '5-hour rate-limit bar + reset countdown',
  '7d': '7-day rate-limit bar + reset countdown',
  turn: 'Current-turn ↑/↓ tokens + cache-hit bar',
  session: 'Session-cumulative Σ tokens + lines + cache-hit bar',
  cost: 'API-equivalent cost (API≈$X.XX)',
  lines: 'Lines added/removed (standalone)',
};

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

// `node bin/config.js preview | head -3` closes stdout early; that's a
// normal way to peek, not an error worth a stack trace.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

/**
 * The style that would actually render right now: env var, then the config
 * file, then the default. An unrecognised name reports as `classic` because
 * that is what lib/theme falls back to at render time — the answer should
 * match the pixels, not the setting.
 */
function currentStyle() {
  const raw = process.env.CC_USAGE_MONITOR_STYLE || loadConfig().style || 'classic';
  const name = String(raw).trim().toLowerCase();
  return VALID_STYLES.includes(name) ? name : 'classic';
}

/**
 * The theme that would actually render on the next turn: the config file
 * bridged into a copy of the environment, then resolved exactly the way the
 * two bins resolve it. Reporting the combined result means the slash
 * command never has to re-derive "preset + overrides" for itself.
 */
function effective() {
  const env = { ...process.env };
  applyConfigToEnv(env);
  const theme = resolveTheme(env);
  return {
    style: theme.name,
    sep: theme.sep,
    barWidth: theme.barWidth,
    boxBarWidth: theme.boxBarWidth,
    // Reported the way `set brackets` accepts it, not as the internal pair.
    brackets: theme.brackets ? theme.brackets.join('') : NO_BRACKETS,
    showReset: theme.showReset,
    showCtxDetail: theme.showCtxDetail,
    labels: theme.labels,
  };
}

function get() {
  process.stdout.write(JSON.stringify({
    configPath: configPath(),
    config: loadConfig(),
    defaultShow: ['model', 'ctx', '5h', '7d', 'session', 'cost'],
    validComponents: VALID_COMPONENTS,
    componentHelp: COMPONENT_HELP,
    validBarStyles: VALID_BAR_STYLES,
    validStyles: VALID_STYLES,
    styleHelp: themeHelp(),
    currentStyle: currentStyle(),
    overrideKeys: OVERRIDE_KEYS,
    overrideHelp: OVERRIDE_HELP,
    effective: effective(),
    booleanKeys: ['twoLine', 'quiet', 'noSession', 'showReset', 'showCtxDetail'],
    numberKeys: ['width', 'barWidth', 'boxBarWidth'],
    note: 'Environment variables (CC_USAGE_MONITOR_*) override this file.',
  }, null, 2) + '\n');
}

const STATUSLINE = path.join(__dirname, 'statusline.js');
// Wide enough that no style ever wraps, so every preview is one line.
const PREVIEW_WIDTH = '400';
const NAME_COLUMN = 9;

/**
 * Render the sample payload once per style (or once, for a named style).
 *
 * Shelling out to the real statusline is the point: the preview is then the
 * genuine renderer, not a second implementation that could drift. The user's
 * other settings (show, barStyle, colors) are deliberately inherited so the
 * preview shows *their* line in each style — only wrapping is pinned.
 */
function preview(only) {
  if (only && !VALID_STYLES.includes(only)) {
    fail(`unknown style "${only}". Valid: ${VALID_STYLES.join(', ')}`);
  }
  const names = only ? [only] : VALID_STYLES;
  const input = JSON.stringify(SAMPLE_PAYLOAD);
  const active = currentStyle();

  for (const name of names) {
    const res = spawnSync(process.execPath, [STATUSLINE], {
      input,
      encoding: 'utf8',
      // A wedged renderer must not hang the slash command ten times over.
      timeout: 5000,
      env: {
        ...process.env,
        CC_USAGE_MONITOR_STYLE: name,
        CC_USAGE_MONITOR_TWO_LINE: '0',
        CC_USAGE_MONITOR_WIDTH: PREVIEW_WIDTH,
      },
    });
    // A wrapped or failed render must not break the table layout; a failed
    // one says so instead of printing a bare style name.
    const failed = Boolean(res.error) || res.status !== 0;
    const line = failed
      ? `(render failed${res.error ? ': ' + res.error.message : ', exit ' + res.status})`
      : String(res.stdout || '').replace(/\r?\n/g, ' ').trimEnd();
    const marker = name === active ? '*' : ' ';
    process.stdout.write(`${name.padEnd(NAME_COLUMN)}${marker} ${line}\n`);
  }
}

function parseBool(value, key) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  fail(`${key} must be true or false, got "${value}"`);
}

/** A bar width from the command line — loud where lib/theme is silent. */
function requireWidth(value, key, max) {
  const n = parseWidthOverride(value, max);
  if (n === null) fail(`${key} must be an integer between 1 and ${max}, got "${value}"`);
  return n;
}

/**
 * `ctx=context,5h=5-hour` -> { ctx: 'context', '5h': '5-hour' }.
 *
 * Unlike the env-var parser this one *rejects* bad input rather than
 * skipping it: a mistyped key on the command line is worth an error, not a
 * silently missing rename. An empty value is legal — it hides that label.
 */
function parseLabelArgs(value) {
  const pairs = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!pairs.length) {
    fail(`labels needs at least one key=value pair. Valid keys: ${LABEL_KEYS.join(', ')}`);
  }
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      fail(`labels needs key=value pairs, got "${pair}". Valid keys: ${LABEL_KEYS.join(', ')}`);
    }
    const name = pair.slice(0, eq).trim();
    if (!LABEL_KEYS.includes(name)) {
      fail(`unknown label "${name}". Valid: ${LABEL_KEYS.join(', ')}`);
    }
    out[name] = pair.slice(eq + 1).trim();
  }
  return out;
}

function set(key, value) {
  if (!key || value == null) fail('usage: config.js set <key> <value>');
  const cfg = loadConfig();
  switch (key) {
    case 'show': {
      const items = value.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = items.filter((s) => !VALID_COMPONENTS.includes(s));
      if (bad.length) fail(`unknown component(s): ${bad.join(', ')}. Valid: ${VALID_COMPONENTS.join(', ')}`);
      if (!items.length) fail('show needs at least one component');
      cfg.show = items;
      break;
    }
    case 'style':
      if (!VALID_STYLES.includes(value)) {
        fail(`unknown style "${value}". Valid: ${VALID_STYLES.join(', ')}`);
      }
      cfg.style = value;
      break;
    case 'barStyle':
      if (!VALID_BAR_STYLES.includes(value)) {
        fail(`unknown bar style "${value}". Valid: ${VALID_BAR_STYLES.join(', ')}`);
      }
      cfg.barStyle = value;
      break;
    case 'twoLine':
    case 'quiet':
    case 'noSession':
    case 'showReset':
    case 'showCtxDetail':
      cfg[key] = parseBool(value, key);
      break;
    case 'width': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n <= 0) fail(`width must be a positive integer, got "${value}"`);
      cfg.width = n;
      break;
    }
    case 'sep': {
      const sep = parseSepOverride(value);
      if (sep === null) {
        fail(`sep must be 1-3 characters and not blank, got "${value}"`);
      }
      cfg.sep = sep;
      break;
    }
    case 'barWidth':
      cfg.barWidth = requireWidth(value, key, MAX_BAR_WIDTH);
      break;
    case 'boxBarWidth':
      cfg.boxBarWidth = requireWidth(value, key, MAX_BOX_BAR_WIDTH);
      break;
    case 'brackets': {
      const brackets = parseBracketsOverride(value);
      if (brackets === null) {
        fail(`brackets must be exactly 2 characters (e.g. [] () <> {} 「」) or "none", got "${value}"`);
      }
      cfg.brackets = brackets === NO_BRACKETS ? NO_BRACKETS : brackets.join('');
      break;
    }
    case 'labels':
      // Merged, not replaced: renaming `ctx` today must not undo the `5h`
      // renamed yesterday. `reset labels` is how you clear the whole set.
      cfg.labels = { ...(cfg.labels || {}), ...parseLabelArgs(value) };
      break;
    default:
      fail(`unknown key "${key}". Valid: ${SETTABLE_KEYS.join(', ')}`);
  }
  const file = saveConfig(cfg);
  process.stdout.write(`saved ${key} to ${file}\n`);
}

function reset(key) {
  if (!key) {
    const file = saveConfig({});
    process.stdout.write(`cleared all settings in ${file}\n`);
    return;
  }
  const cfg = loadConfig();
  if (!(key in cfg)) {
    process.stdout.write(`${key} was not set — nothing to do\n`);
    return;
  }
  delete cfg[key];
  const file = saveConfig(cfg);
  process.stdout.write(`removed ${key} from ${file}\n`);
}

const [, , cmd, key, ...rest] = process.argv;
switch (cmd) {
  case 'get':
  case undefined:
    get();
    break;
  case 'set':
    set(key, rest.join(' ') || undefined);
    break;
  case 'reset':
    reset(key);
    break;
  case 'preview':
    preview(key);
    break;
  default:
    fail(`unknown command "${cmd}". Usage: config.js get | set <key> <value> | reset [key] | preview [style]`);
}
