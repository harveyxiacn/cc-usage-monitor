'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadConfig, saveConfig, applyConfigToEnv, configPath, VALID_STYLES } = require('../lib/config');
const { THEME_NAMES } = require('../lib/theme');
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
