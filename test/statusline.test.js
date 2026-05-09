'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, STATUSLINE } = require('./helpers');

test('statusline: full fixture shows model + 5h + 7d + cost + lines', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json');
  assert.equal(code, 0);
  assert.match(stdout, /Opus/);
  assert.match(stdout, /5h /);
  assert.match(stdout, /7d /);
  assert.match(stdout, /24%/);   // 23.5 rounds to 24
  assert.match(stdout, /41%/);
  assert.match(stdout, /\$0\.123/); // 0.1234 -> $0.123 (sub-dollar, 3 decimals)
  assert.match(stdout, /\+156/);
  assert.match(stdout, /-23/);
});

test('statusline: high-usage fixture shows 95% and 88%', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'high-usage.json');
  assert.equal(code, 0);
  assert.match(stdout, /Sonnet/);
  assert.match(stdout, /95%/);
  assert.match(stdout, /88%/);
  assert.match(stdout, /\$4\.88/);
});

test('statusline: no rate_limits fixture omits 5h/7d but keeps cost+model', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-rate-limits.json');
  assert.equal(code, 0);
  assert.match(stdout, /Haiku/);
  assert.doesNotMatch(stdout, /5h /);
  assert.doesNotMatch(stdout, /7d /);
  assert.match(stdout, /\$0\.0034/);
});

test('statusline: missing-cost fixture shows rate limits but no cost', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'missing-cost.json');
  assert.equal(code, 0);
  assert.match(stdout, /5h /);
  assert.match(stdout, /7d /);
  assert.match(stdout, /5%/);
  assert.match(stdout, /12%/);
  assert.doesNotMatch(stdout, /\$/);
});

test('statusline: empty stdin produces a friendly waiting message and exits 0', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [STATUSLINE], {
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stdin.end(''); // empty stdin

  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.match(stdout, /waiting for first turn/);
});
