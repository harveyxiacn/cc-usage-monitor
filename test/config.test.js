'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadConfig, saveConfig, applyConfigToEnv, configPath, VALID_STYLES, OVERRIDE_KEYS } = require('../lib/config');
const { THEME_NAMES, LABEL_KEYS } = require('../lib/theme');
const { runScript, STATUSLINE, ON_STOP } = require('./helpers');

function withTempConfig(content, fn) {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  if (content != null) fs.writeFileSync(tmp, content);
  const prev = process.env.CC_USAGE_MONITOR_CONFIG;
  process.env.CC_USAGE_MONITOR_CONFIG = tmp;
  try {
    return fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.CC_USAGE_MONITOR_CONFIG;
    else process.env.CC_USAGE_MONITOR_CONFIG = prev;
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}

test('config: loadConfig validates and drops bad values', () => {
  withTempConfig(JSON.stringify({
    show: ['model', 'bogus', 'cost'],
    barStyle: 'neon',
    twoLine: 'yes',
    width: -5,
    quiet: true,
  }), () => {
    const cfg = loadConfig();
    assert.deepEqual(cfg.show, ['model', 'cost']); // bogus dropped
    assert.equal(cfg.barStyle, undefined);          // invalid style dropped
    assert.equal(cfg.twoLine, undefined);           // non-boolean dropped
    assert.equal(cfg.width, undefined);             // non-positive dropped
    assert.equal(cfg.quiet, true);
  });
});

test('config: missing or corrupt file yields empty config', () => {
  withTempConfig(null, () => {
    assert.deepEqual(loadConfig(), {});
  });
  withTempConfig('{not json', () => {
    assert.deepEqual(loadConfig(), {});
  });
});

test('config: saveConfig round-trips through loadConfig', () => {
  withTempConfig(null, (tmp) => {
    saveConfig({ show: ['model', 'cost'], barStyle: 'shade' });
    assert.equal(configPath(), tmp);
    const cfg = loadConfig();
    assert.deepEqual(cfg.show, ['model', 'cost']);
    assert.equal(cfg.barStyle, 'shade');
  });
});

test('config: applyConfigToEnv fills unset vars but never overrides env', () => {
  withTempConfig(JSON.stringify({ show: ['model', 'cost'], barStyle: 'shade', quiet: true }), () => {
    const env = { CC_USAGE_MONITOR_SHOW: 'ctx' };
    applyConfigToEnv(env);
    assert.equal(env.CC_USAGE_MONITOR_SHOW, 'ctx');        // env wins
    assert.equal(env.CC_USAGE_MONITOR_BAR_STYLE, 'shade'); // filled from config
    assert.equal(env.CC_USAGE_MONITOR_QUIET, '1');
  });
});

test('config: style round-trips and only valid names survive', () => {
  withTempConfig(null, () => {
    saveConfig({ style: 'dots' });
    assert.equal(loadConfig().style, 'dots');
  });
  withTempConfig(JSON.stringify({ style: 'nonsense' }), () => {
    assert.equal(loadConfig().style, undefined);
  });
  withTempConfig(JSON.stringify({ style: 42 }), () => {
    assert.equal(loadConfig().style, undefined);
  });
});

test('config: applyConfigToEnv bridges style, env still wins', () => {
  withTempConfig(JSON.stringify({ style: 'emoji' }), () => {
    const fromFile = {};
    applyConfigToEnv(fromFile);
    assert.equal(fromFile.CC_USAGE_MONITOR_STYLE, 'emoji');

    const fromEnv = { CC_USAGE_MONITOR_STYLE: 'mono' };
    applyConfigToEnv(fromEnv);
    assert.equal(fromEnv.CC_USAGE_MONITOR_STYLE, 'mono');
  });
});

test('config: VALID_STYLES lists the ten presets in menu order', () => {
  assert.deepEqual(VALID_STYLES, THEME_NAMES);
  assert.equal(VALID_STYLES.length, 10);
  assert.equal(VALID_STYLES[0], 'classic');
});

test('statusline: config file selects components and bar style', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-sl-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ show: ['model', 'cost'], barStyle: 'ascii' }));
  try {
    const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
      CC_USAGE_MONITOR_CONFIG: tmp,
    });
    assert.equal(code, 0);
    assert.match(stdout, /Opus/);
    assert.match(stdout, /API≈\$0\.123/);
    assert.doesNotMatch(stdout, /5h /);  // not selected
    assert.doesNotMatch(stdout, /ctx /); // not selected
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('statusline: CC_USAGE_MONITOR_SHOW env overrides the config file', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-ov-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ show: ['model'] }));
  try {
    const { stdout, code } = await runScript(STATUSLINE, 'full.json', {
      CC_USAGE_MONITOR_CONFIG: tmp,
      CC_USAGE_MONITOR_SHOW: 'cost',
    });
    assert.equal(code, 0);
    assert.match(stdout, /API≈\$0\.123/);
    assert.doesNotMatch(stdout, /Opus/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('on-stop: quiet=true in config silences the box', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-q-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ quiet: true }));
  try {
    const { stdout, stderr, code } = await runScript(ON_STOP, 'full.json', {
      CC_USAGE_MONITOR_CONFIG: tmp,
    });
    assert.equal(code, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('config CLI: get prints valid components; set rejects bad input', async () => {
  const { spawn } = require('node:child_process');
  const CONFIG_CLI = path.join(__dirname, '..', 'bin', 'config.js');
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-cli-${process.pid}.json`);

  const run = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CONFIG_CLI, ...args], {
      env: { ...process.env, CC_USAGE_MONITOR_CONFIG: tmp },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });

  try {
    const get = await run(['get']);
    assert.equal(get.code, 0);
    const info = JSON.parse(get.stdout);
    assert.ok(info.validComponents.includes('cost'));
    assert.ok(info.validBarStyles.includes('shade'));

    const setOk = await run(['set', 'show', 'model,cost']);
    assert.equal(setOk.code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(tmp, 'utf8')).show, ['model', 'cost']);

    const setBad = await run(['set', 'show', 'model,nope']);
    assert.equal(setBad.code, 1);
    assert.match(setBad.stderr, /unknown component/);

    const setBadStyle = await run(['set', 'barStyle', 'neon']);
    assert.equal(setBadStyle.code, 1);

    const reset = await run(['reset', 'show']);
    assert.equal(reset.code, 0);
    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf8')).show, undefined);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
});

const CONFIG_CLI = path.join(__dirname, '..', 'bin', 'config.js');

/**
 * Run the config CLI against a throwaway config file, with the developer's
 * own CC_USAGE_MONITOR_* variables stripped so their shell can't change the
 * result (the preview marks the *active* style, which an env var can set).
 */
function runCli(args, tmp, extraEnv = {}) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CC_USAGE_MONITOR_')) delete env[key];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CONFIG_CLI, ...args], {
      env: { ...env, NO_COLOR: '1', CC_USAGE_MONITOR_CONFIG: tmp, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function withTempFile(fn) {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-style-cli-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  return Promise.resolve(fn(tmp)).finally(() => {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  });
}

test('config CLI: get exposes validStyles, styleHelp and currentStyle', async () => {
  await withTempFile(async (tmp) => {
    const { stdout, code } = await runCli(['get'], tmp);
    assert.equal(code, 0);
    const info = JSON.parse(stdout);
    assert.deepEqual(info.validStyles, VALID_STYLES);
    assert.equal(info.validStyles.length, 10);
    assert.deepEqual(Object.keys(info.styleHelp), VALID_STYLES);
    for (const name of VALID_STYLES) {
      assert.equal(typeof info.styleHelp[name], 'string', name);
      assert.ok(info.styleHelp[name].length <= 70, name);
    }
    assert.equal(info.currentStyle, 'classic'); // nothing set yet
    assert.equal(info.componentHelp.model, 'Model name (e.g. "Fable 5.1")');
  });
});

test('config CLI: set style saves, rejects unknown names, and reset clears it', async () => {
  await withTempFile(async (tmp) => {
    const ok = await runCli(['set', 'style', 'dots'], tmp);
    assert.equal(ok.code, 0);
    assert.match(ok.stdout, /saved style/);
    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf8')).style, 'dots');

    // currentStyle now reflects the saved file.
    const after = JSON.parse((await runCli(['get'], tmp)).stdout);
    assert.equal(after.currentStyle, 'dots');

    const bad = await runCli(['set', 'style', 'nope'], tmp);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /unknown style "nope"/);
    for (const name of VALID_STYLES) {
      assert.ok(bad.stderr.includes(name), `error should list ${name}`);
    }
    // The rejected value must not have been written.
    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf8')).style, 'dots');

    const cleared = await runCli(['reset', 'style'], tmp);
    assert.equal(cleared.code, 0);
    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf8')).style, undefined);
  });
});

test('config CLI: env var wins over the file in currentStyle', async () => {
  await withTempFile(async (tmp) => {
    fs.writeFileSync(tmp, JSON.stringify({ style: 'dots' }));
    const { stdout } = await runCli(['get'], tmp, { CC_USAGE_MONITOR_STYLE: 'mono' });
    assert.equal(JSON.parse(stdout).currentStyle, 'mono');
    // An unknown env value reports what actually renders: classic.
    const bogus = await runCli(['get'], tmp, { CC_USAGE_MONITOR_STYLE: 'nope' });
    assert.equal(JSON.parse(bogus.stdout).currentStyle, 'classic');
  });
});

test('config CLI: preview renders one line per style, marking the active one', async () => {
  await withTempFile(async (tmp) => {
    const { stdout, code } = await runCli(['preview'], tmp);
    assert.equal(code, 0);
    const lines = stdout.replace(/\n$/, '').split('\n');
    assert.equal(lines.length, 10);
    lines.forEach((line, i) => {
      const name = VALID_STYLES[i];
      assert.ok(line.startsWith(name), `line ${i} should start with ${name}: ${line}`);
      // Something was actually rendered after the name column + marker.
      assert.ok(line.slice(name.length + 2).trim().length > 10, `empty preview for ${name}: ${line}`);
    });
    // Exactly one active marker, on the default style.
    const marked = lines.filter((l) => l[9] === '*');
    assert.equal(marked.length, 1);
    assert.ok(marked[0].startsWith('classic'), marked[0]);
  });
});

test('config CLI: preview accepts one style and rejects unknown ones', async () => {
  await withTempFile(async (tmp) => {
    const one = await runCli(['preview', 'ascii'], tmp);
    assert.equal(one.code, 0);
    const lines = one.stdout.replace(/\n$/, '').split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('ascii'), lines[0]);
    assert.match(lines[0], /\[#+-*\]/);

    const bad = await runCli(['preview', 'nope'], tmp);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /unknown style "nope"/);
  });
});

// --- fine-tuning overrides -----------------------------------------------

test('config: OVERRIDE_KEYS is the documented set, in a fixed order', () => {
  assert.deepEqual(OVERRIDE_KEYS, [
    'sep', 'barWidth', 'boxBarWidth', 'brackets', 'showReset', 'showCtxDetail', 'labels',
  ]);
});

test('config: loadConfig keeps every valid override', () => {
  withTempConfig(JSON.stringify({
    sep: '»',
    barWidth: 8,
    boxBarWidth: 16,
    brackets: '()',
    showReset: false,
    showCtxDetail: true,
    labels: { ctx: 'context', '5h': '5-hour', cache: '' },
  }), () => {
    const cfg = loadConfig();
    assert.equal(cfg.sep, '»');
    assert.equal(cfg.barWidth, 8);
    assert.equal(cfg.boxBarWidth, 16);
    assert.equal(cfg.brackets, '()');
    assert.equal(cfg.showReset, false);   // a meaningful false, not "missing"
    assert.equal(cfg.showCtxDetail, true);
    assert.deepEqual(cfg.labels, { ctx: 'context', '5h': '5-hour', cache: '' });
  });
  // `none` is a legal brackets value and round-trips as itself.
  withTempConfig(JSON.stringify({ brackets: 'none' }), () => {
    assert.equal(loadConfig().brackets, 'none');
  });
});

test('config: loadConfig drops every invalid override', () => {
  withTempConfig(JSON.stringify({
    sep: '    ',          // blank
    barWidth: 0,          // below the range
    boxBarWidth: 99,      // above the range
    brackets: '[[]]',     // not two characters
    showReset: 'yes',     // not a boolean
    showCtxDetail: 1,     // not a boolean
    labels: 'ctx=context', // not an object
  }), () => {
    assert.deepEqual(loadConfig(), {});
  });
  // Non-integer widths and non-string separators go too.
  withTempConfig(JSON.stringify({ barWidth: 4.5, boxBarWidth: '16', sep: 5 }), () => {
    assert.deepEqual(loadConfig(), {});
  });
});

test('config: loadConfig filters labels to known keys with string values', () => {
  withTempConfig(JSON.stringify({
    labels: { ctx: 'context', bogus: 'x', '5h': 42, cache: '', cost: 'a,b' },
  }), () => {
    // Unknown key, non-string value, and a value carrying the separator the
    // env encoding uses are all dropped; the rest survive.
    assert.deepEqual(loadConfig().labels, { ctx: 'context', cache: '' });
  });
  withTempConfig(JSON.stringify({ labels: { bogus: 'x' } }), () => {
    assert.equal(loadConfig().labels, undefined); // nothing usable -> absent
  });
  withTempConfig(JSON.stringify({ labels: ['ctx', 'context'] }), () => {
    assert.equal(loadConfig().labels, undefined); // an array is not a label map
  });
});

test('config: applyConfigToEnv bridges every override, and env still wins', () => {
  withTempConfig(JSON.stringify({
    sep: '»',
    barWidth: 8,
    boxBarWidth: 16,
    brackets: 'none',
    showReset: false,
    showCtxDetail: false,
    labels: { ctx: 'context', cache: '' },
  }), () => {
    const fromFile = {};
    applyConfigToEnv(fromFile);
    assert.equal(fromFile.CC_USAGE_MONITOR_SEP, '»');
    assert.equal(fromFile.CC_USAGE_MONITOR_BAR_WIDTH, '8');
    assert.equal(fromFile.CC_USAGE_MONITOR_BOX_BAR_WIDTH, '16');
    assert.equal(fromFile.CC_USAGE_MONITOR_BRACKETS, 'none');
    assert.equal(fromFile.CC_USAGE_MONITOR_SHOW_RESET, '0');
    assert.equal(fromFile.CC_USAGE_MONITOR_CTX_DETAIL, '0');
    assert.equal(fromFile.CC_USAGE_MONITOR_LABELS, 'ctx=context,cache=');

    const fromEnv = {
      CC_USAGE_MONITOR_SEP: '|',
      CC_USAGE_MONITOR_BAR_WIDTH: '3',
      CC_USAGE_MONITOR_BOX_BAR_WIDTH: '4',
      CC_USAGE_MONITOR_BRACKETS: '<>',
      CC_USAGE_MONITOR_SHOW_RESET: '1',
      CC_USAGE_MONITOR_CTX_DETAIL: '1',
      CC_USAGE_MONITOR_LABELS: 'ctx=CTX',
    };
    applyConfigToEnv(fromEnv);
    assert.deepEqual(fromEnv, {
      CC_USAGE_MONITOR_SEP: '|',
      CC_USAGE_MONITOR_BAR_WIDTH: '3',
      CC_USAGE_MONITOR_BOX_BAR_WIDTH: '4',
      CC_USAGE_MONITOR_BRACKETS: '<>',
      CC_USAGE_MONITOR_SHOW_RESET: '1',
      CC_USAGE_MONITOR_CTX_DETAIL: '1',
      CC_USAGE_MONITOR_LABELS: 'ctx=CTX',
    });
  });
});

test('config: a showReset of true is bridged as 1, and an empty labels map not at all', () => {
  withTempConfig(JSON.stringify({ showReset: true, showCtxDetail: true, labels: {} }), () => {
    const env = {};
    applyConfigToEnv(env);
    assert.equal(env.CC_USAGE_MONITOR_SHOW_RESET, '1');
    assert.equal(env.CC_USAGE_MONITOR_CTX_DETAIL, '1');
    assert.equal(env.CC_USAGE_MONITOR_LABELS, undefined);
  });
});

test('config CLI: set and reset each override key', async () => {
  await withTempFile(async (tmp) => {
    const read = () => JSON.parse(fs.readFileSync(tmp, 'utf8'));

    for (const [key, value, expected] of [
      ['sep', '»', '»'],
      ['barWidth', '8', 8],
      ['boxBarWidth', '16', 16],
      ['brackets', '()', '()'],
      ['showReset', 'false', false],
      ['showCtxDetail', '0', false],
    ]) {
      const res = await runCli(['set', key, value], tmp);
      assert.equal(res.code, 0, `${key}: ${res.stderr}`);
      assert.match(res.stdout, new RegExp(`saved ${key}`));
      assert.deepEqual(read()[key], expected, key);
    }
    // `none` is stored verbatim so the file says what the user typed.
    assert.equal((await runCli(['set', 'brackets', 'none'], tmp)).code, 0);
    assert.equal(read().brackets, 'none');

    for (const key of OVERRIDE_KEYS.filter((k) => k !== 'labels')) {
      const res = await runCli(['reset', key], tmp);
      assert.equal(res.code, 0, key);
      assert.equal(read()[key], undefined, key);
    }
  });
});

test('config CLI: set labels merges, blanks one label, and reset clears them all', async () => {
  await withTempFile(async (tmp) => {
    const read = () => JSON.parse(fs.readFileSync(tmp, 'utf8'));

    assert.equal((await runCli(['set', 'labels', 'ctx=context,5h=5-hour'], tmp)).code, 0);
    assert.deepEqual(read().labels, { ctx: 'context', '5h': '5-hour' });

    // A second `set` merges into the saved object instead of replacing it.
    assert.equal((await runCli(['set', 'labels', '7d=7-day'], tmp)).code, 0);
    assert.deepEqual(read().labels, { ctx: 'context', '5h': '5-hour', '7d': '7-day' });

    // An empty value blanks that one label (it hides it at render time).
    assert.equal((await runCli(['set', 'labels', 'ctx='], tmp)).code, 0);
    assert.deepEqual(read().labels, { ctx: '', '5h': '5-hour', '7d': '7-day' });

    // reset drops the whole object, not one entry.
    assert.equal((await runCli(['reset', 'labels'], tmp)).code, 0);
    assert.equal(read().labels, undefined);
  });
});

test('config CLI: every override rejects bad input with the accepted values', async () => {
  await withTempFile(async (tmp) => {
    fs.writeFileSync(tmp, JSON.stringify({ sep: '»', barWidth: 8 }));

    const cases = [
      [['set', 'sep', '   '], /sep must be 1-3 characters/],
      [['set', 'barWidth', '99'], /barWidth must be an integer between 1 and 20/],
      [['set', 'barWidth', 'wide'], /barWidth must be an integer between 1 and 20/],
      [['set', 'boxBarWidth', '0'], /boxBarWidth must be an integer between 1 and 40/],
      [['set', 'brackets', '[[]]'], /brackets must be exactly 2 characters/],
      [['set', 'showReset', 'maybe'], /showReset must be true or false/],
      [['set', 'showCtxDetail', 'maybe'], /showCtxDetail must be true or false/],
      [['set', 'labels', 'bogus=x'], /unknown label "bogus"/],
      [['set', 'labels', 'nonsense'], /labels needs key=value pairs/],
    ];
    for (const [args, pattern] of cases) {
      const res = await runCli(args, tmp);
      assert.equal(res.code, 1, args.join(' '));
      assert.match(res.stderr, pattern, args.join(' '));
    }
    // Nothing invalid was written along the way.
    assert.deepEqual(JSON.parse(fs.readFileSync(tmp, 'utf8')), { sep: '»', barWidth: 8 });

    // The unknown-key message lists the overrides too.
    const unknown = await runCli(['set', 'nonsense', '1'], tmp);
    assert.equal(unknown.code, 1);
    for (const key of OVERRIDE_KEYS) {
      assert.ok(unknown.stderr.includes(key), `error should list ${key}: ${unknown.stderr}`);
    }
  });
});

test('config CLI: get exposes overrideKeys, overrideHelp and the effective theme', async () => {
  await withTempFile(async (tmp) => {
    const clean = JSON.parse((await runCli(['get'], tmp)).stdout);
    assert.deepEqual(clean.overrideKeys, OVERRIDE_KEYS);
    assert.deepEqual(Object.keys(clean.overrideHelp), OVERRIDE_KEYS);
    for (const key of OVERRIDE_KEYS) {
      assert.equal(typeof clean.overrideHelp[key], 'string', key);
      assert.ok(clean.overrideHelp[key].length > 0, key);
    }
    // With nothing saved, `effective` is plain classic.
    assert.deepEqual(clean.effective, {
      style: 'classic',
      sep: '│',
      barWidth: 5,
      boxBarWidth: 12,
      brackets: 'none',
      showReset: true,
      showCtxDetail: true,
      labels: { ctx: 'ctx', '5h': '5h', '7d': '7d', cache: 'cache', turn: '', session: '', cost: '', model: '' },
    });

    // Preset + overrides, combined the way the renderers will combine them.
    fs.writeFileSync(tmp, JSON.stringify({
      style: 'dots', sep: '»', barWidth: 8, brackets: '<>', showReset: false,
      labels: { ctx: 'context' },
    }));
    const saved = JSON.parse((await runCli(['get'], tmp)).stdout).effective;
    assert.equal(saved.style, 'dots');
    assert.equal(saved.sep, '»');
    assert.equal(saved.barWidth, 8);
    assert.equal(saved.brackets, '<>');
    assert.equal(saved.showReset, false);
    assert.equal(saved.labels.ctx, 'context');
    assert.equal(saved.labels['5h'], '5h'); // untouched by the merge
    assert.deepEqual(Object.keys(saved.labels), LABEL_KEYS);

    // An env var still wins over the file, and `effective` says so.
    const overridden = JSON.parse(
      (await runCli(['get'], tmp, { CC_USAGE_MONITOR_SEP: '::', CC_USAGE_MONITOR_BRACKETS: 'none' })).stdout
    ).effective;
    assert.equal(overridden.sep, '::');
    assert.equal(overridden.brackets, 'none');
  });
});

test('config CLI: preview renders the saved overrides on every preset', async () => {
  await withTempFile(async (tmp) => {
    fs.writeFileSync(tmp, JSON.stringify({ sep: '»', brackets: '<>' }));
    const { stdout, code } = await runCli(['preview'], tmp);
    assert.equal(code, 0);
    const lines = stdout.replace(/\n$/, '').split('\n');
    assert.equal(lines.length, 10);
    for (const line of lines) {
      const name = line.slice(0, 9).trim();
      // `badge` draws pills instead of a separator, and colors are off here.
      if (name !== 'badge') assert.ok(line.includes('»'), `no separator override in: ${line}`);
      // minimal has no bars to wrap; everything else picks up the brackets.
      if (name !== 'minimal') assert.ok(line.includes('<'), `no bracket override in: ${line}`);
    }
  });
});

test('config: overrides reach the statusline through the config file', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-ov-keys-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    sep: '»', barWidth: 8, brackets: '()', showCtxDetail: false, labels: { ctx: 'context' },
  }));
  try {
    const { stdout, code } = await runScript(STATUSLINE, 'fable.json', { CC_USAGE_MONITOR_CONFIG: tmp });
    assert.equal(code, 0);
    assert.match(stdout, /context \([▰▱]{8}\) 32%/);
    assert.match(stdout, /»/);
    assert.doesNotMatch(stdout, /\(320k\/1\.0M\)/);
    assert.doesNotMatch(stdout, /│/);

    // …and an env var still overrides the file, one key at a time.
    const env = await runScript(STATUSLINE, 'fable.json', {
      CC_USAGE_MONITOR_CONFIG: tmp,
      CC_USAGE_MONITOR_BRACKETS: 'none',
    });
    assert.equal(env.code, 0);
    assert.match(env.stdout, /context [▰▱]{8} 32%/);
    assert.doesNotMatch(env.stdout, /\(▰/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('config: overrides reach the Stop-hook box through the config file', async () => {
  const tmp = path.join(os.tmpdir(), `cc-usage-monitor-cfg-ov-box-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ boxBarWidth: 16, brackets: '()' }));
  try {
    const { stderr, code } = await runScript(ON_STOP, 'full.json', { CC_USAGE_MONITOR_CONFIG: tmp });
    assert.equal(code, 0);
    assert.match(stderr, /\([▰▱]{16}\)/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
