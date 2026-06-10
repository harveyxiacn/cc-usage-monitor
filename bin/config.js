#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor config CLI — backs the /cc-usage-monitor:config slash
 * command, and works standalone:
 *
 *   node bin/config.js get
 *   node bin/config.js set show model,ctx,5h,7d,cost
 *   node bin/config.js set barStyle shade
 *   node bin/config.js set twoLine true | set width 120 | set quiet false
 *   node bin/config.js reset [key]
 *
 * `get` prints JSON: current saved config, the config file path, and the
 * valid values, so an agent can render a checklist without guessing.
 * Exits non-zero with a message on stderr for invalid input.
 */

const {
  VALID_COMPONENTS,
  VALID_BAR_STYLES,
  configPath,
  loadConfig,
  saveConfig,
} = require('../lib/config');

const COMPONENT_HELP = {
  model: 'Model name (e.g. "Fable 5")',
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

function get() {
  process.stdout.write(JSON.stringify({
    configPath: configPath(),
    config: loadConfig(),
    defaultShow: ['model', 'ctx', '5h', '7d', 'session', 'cost'],
    validComponents: VALID_COMPONENTS,
    componentHelp: COMPONENT_HELP,
    validBarStyles: VALID_BAR_STYLES,
    booleanKeys: ['twoLine', 'quiet', 'noSession'],
    numberKeys: ['width'],
    note: 'Environment variables (CC_USAGE_MONITOR_*) override this file.',
  }, null, 2) + '\n');
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
      fail(`unknown key "${key}". Valid: show, barStyle, twoLine, width, quiet, noSession`);
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
  default:
    fail(`unknown command "${cmd}". Usage: config.js get | set <key> <value> | reset [key]`);
}
