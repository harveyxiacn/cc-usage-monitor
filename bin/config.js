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
 * `get` prints JSON: current saved config, the config file path, and the
 * valid values, so an agent can render a checklist without guessing.
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
  configPath,
  loadConfig,
  saveConfig,
} = require('../lib/config');
const { themeHelp, SAMPLE_PAYLOAD } = require('../lib/theme');

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
    booleanKeys: ['twoLine', 'quiet', 'noSession'],
    numberKeys: ['width'],
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
      cfg[key] = parseBool(value, key);
      break;
    case 'width': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n <= 0) fail(`width must be a positive integer, got "${value}"`);
      cfg.width = n;
      break;
    }
    default:
      fail(`unknown key "${key}". Valid: show, style, barStyle, twoLine, width, quiet, noSession`);
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
