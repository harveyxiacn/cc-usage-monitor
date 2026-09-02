'use strict';

/**
 * Persistent user configuration for cc-usage-monitor.
 *
 * Lives in a small JSON file (default: ~/.claude/cc-usage-monitor.json) so
 * choices made via /cc-usage-monitor:config survive across sessions without
 * editing settings.json. Environment variables always win over the file —
 * the file only fills in env vars that aren't already set, so existing
 * setups keep working unchanged.
 *
 * Recognised keys:
 *   show      string[]  statusline components, in display order
 *   style     string    one of the ten presets in lib/theme.js
 *   barStyle  string    one of: block, shade, square, thin, ascii
 *   twoLine   boolean   always wrap the statusline to two lines
 *   width     number    wrap threshold in columns
 *   quiet     boolean   silence the post-task Stop-hook box
 *   noSession boolean   skip the transcript walk in the statusline
 *
 * …plus the fine-tuning overrides that layer on top of the chosen preset
 * (OVERRIDE_KEYS — see lib/theme.js for what each one does):
 *   sep           string   separator glyph, 1-3 characters
 *   barWidth      number   statusline bar cells, 1-20
 *   boxBarWidth   number   Stop-hook box bar cells, 1-40
 *   brackets      string   two characters wrapping every bar, or "none"
 *   showReset     boolean  show the rate-limit reset countdown
 *   showCtxDetail boolean  show the (used/total) context suffix
 *   labels        object   statusline label -> replacement text
 *
 * Reading is a single small-file read per process start (the statusline is
 * spawned per turn) and is wrapped in try/catch — a missing or corrupt
 * config must never break the host.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  THEME_NAMES,
  OVERRIDE_ENV,
  LABEL_KEYS,
  MAX_BAR_WIDTH,
  MAX_BOX_BAR_WIDTH,
  NO_BRACKETS,
  parseSepOverride,
  parseWidthOverride,
  parseBracketsOverride,
} = require('./theme');

const VALID_COMPONENTS = ['model', 'ctx', '5h', '7d', 'turn', 'session', 'cost', 'lines'];
const VALID_BAR_STYLES = ['block', 'shade', 'square', 'thin', 'ascii'];
// Single source of truth: the presets themselves, in menu order.
const VALID_STYLES = THEME_NAMES;
// The fine-tuning overrides, in the order lib/theme declares them — which is
// the order `bin/config.js get` reports and the slash commands list.
const OVERRIDE_KEYS = Object.keys(OVERRIDE_ENV);

function configPath() {
  if (process.env.CC_USAGE_MONITOR_CONFIG) return process.env.CC_USAGE_MONITOR_CONFIG;
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'cc-usage-monitor.json');
}

/** Read + validate the config file. Unknown keys and invalid values are dropped. */
function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(configPath(), 'utf8');
  } catch {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};

  const out = {};
  if (Array.isArray(parsed.show)) {
    const show = parsed.show
      .map((s) => String(s).trim())
      .filter((s) => VALID_COMPONENTS.includes(s));
    if (show.length) out.show = show;
  }
  if (VALID_STYLES.includes(parsed.style)) out.style = parsed.style;
  if (VALID_BAR_STYLES.includes(parsed.barStyle)) out.barStyle = parsed.barStyle;
  if (typeof parsed.twoLine === 'boolean') out.twoLine = parsed.twoLine;
  if (Number.isFinite(parsed.width) && parsed.width > 0) out.width = Math.floor(parsed.width);
  if (typeof parsed.quiet === 'boolean') out.quiet = parsed.quiet;
  if (typeof parsed.noSession === 'boolean') out.noSession = parsed.noSession;
  loadOverrides(parsed, out);
  return out;
}

/**
 * Validate the fine-tuning overrides, reusing lib/theme's parsers so the
 * file and the environment agree on what counts as valid. Anything the
 * parser rejects is dropped, exactly like the older keys.
 */
function loadOverrides(parsed, out) {
  if (typeof parsed.sep === 'string' && parseSepOverride(parsed.sep) !== null) {
    out.sep = parsed.sep;
  }
  if (typeof parsed.barWidth === 'number') {
    const n = parseWidthOverride(parsed.barWidth, MAX_BAR_WIDTH);
    if (n !== null) out.barWidth = n;
  }
  if (typeof parsed.boxBarWidth === 'number') {
    const n = parseWidthOverride(parsed.boxBarWidth, MAX_BOX_BAR_WIDTH);
    if (n !== null) out.boxBarWidth = n;
  }
  if (typeof parsed.brackets === 'string') {
    const b = parseBracketsOverride(parsed.brackets);
    if (b === NO_BRACKETS) out.brackets = NO_BRACKETS;
    else if (b) out.brackets = b.join('');
  }
  if (typeof parsed.showReset === 'boolean') out.showReset = parsed.showReset;
  if (typeof parsed.showCtxDetail === 'boolean') out.showCtxDetail = parsed.showCtxDetail;

  if (parsed.labels && typeof parsed.labels === 'object' && !Array.isArray(parsed.labels)) {
    const labels = {};
    // Walk the known keys rather than the file's, so an unknown (or
    // inherited) property can never reach the theme.
    for (const key of LABEL_KEYS) {
      const value = parsed.labels[key];
      // A comma would corrupt the `key=value,key=value` env encoding below.
      if (typeof value === 'string' && !value.includes(',')) labels[key] = value;
    }
    if (Object.keys(labels).length) out.labels = labels;
  }
}

function saveConfig(config) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}

/**
 * Bridge the config file into the env-var interface the rest of the code
 * already speaks. Only fills in variables that are NOT already set, so
 * explicit env vars (and per-session overrides) keep priority.
 * Call this before the bin scripts read any CC_USAGE_MONITOR_* variable.
 */
function applyConfigToEnv(env = process.env) {
  const cfg = loadConfig();
  if (cfg.show && env.CC_USAGE_MONITOR_SHOW == null) {
    env.CC_USAGE_MONITOR_SHOW = cfg.show.join(',');
  }
  if (cfg.style && env.CC_USAGE_MONITOR_STYLE == null) {
    env.CC_USAGE_MONITOR_STYLE = cfg.style;
  }
  if (cfg.barStyle && env.CC_USAGE_MONITOR_BAR_STYLE == null) {
    env.CC_USAGE_MONITOR_BAR_STYLE = cfg.barStyle;
  }
  if (cfg.twoLine && env.CC_USAGE_MONITOR_TWO_LINE == null) {
    env.CC_USAGE_MONITOR_TWO_LINE = '1';
  }
  if (cfg.width && env.CC_USAGE_MONITOR_WIDTH == null) {
    env.CC_USAGE_MONITOR_WIDTH = String(cfg.width);
  }
  if (cfg.quiet && env.CC_USAGE_MONITOR_QUIET == null) {
    env.CC_USAGE_MONITOR_QUIET = '1';
  }
  if (cfg.noSession && env.CC_USAGE_MONITOR_NO_SESSION == null) {
    env.CC_USAGE_MONITOR_NO_SESSION = '1';
  }
  applyOverridesToEnv(cfg, env);
  return cfg;
}

/** `{ ctx: 'context', cache: '' }` -> `ctx=context,cache=`. */
function encodeLabels(labels) {
  return Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(',');
}

/**
 * Bridge the fine-tuning overrides. Same rule as above — fill in, never
 * overwrite — but these keys carry meaningful `false`/`0` values, so the
 * test is "is it present in the file", not "is it truthy".
 */
function applyOverridesToEnv(cfg, env) {
  const put = (key, value) => {
    if (env[OVERRIDE_ENV[key]] == null) env[OVERRIDE_ENV[key]] = value;
  };
  if (cfg.sep != null) put('sep', cfg.sep);
  if (cfg.barWidth != null) put('barWidth', String(cfg.barWidth));
  if (cfg.boxBarWidth != null) put('boxBarWidth', String(cfg.boxBarWidth));
  if (cfg.brackets != null) put('brackets', cfg.brackets);
  if (typeof cfg.showReset === 'boolean') put('showReset', cfg.showReset ? '1' : '0');
  if (typeof cfg.showCtxDetail === 'boolean') put('showCtxDetail', cfg.showCtxDetail ? '1' : '0');
  if (cfg.labels && Object.keys(cfg.labels).length) put('labels', encodeLabels(cfg.labels));
}

module.exports = {
  VALID_COMPONENTS,
  VALID_BAR_STYLES,
  VALID_STYLES,
  OVERRIDE_KEYS,
  configPath,
  loadConfig,
  saveConfig,
  applyConfigToEnv,
};
