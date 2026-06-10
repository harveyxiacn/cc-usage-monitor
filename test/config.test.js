'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadConfig, saveConfig, applyConfigToEnv, configPath } = require('../lib/config');
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
