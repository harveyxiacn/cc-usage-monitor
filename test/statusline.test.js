'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, STATUSLINE } = require('./helpers');

test('statusline: full fixture shows model + 5h + 7d + tokens + API≈cost + lines', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'full.json');
  assert.equal(code, 0);
  assert.match(stdout, /Opus/);
  assert.match(stdout, /5h /);
  assert.match(stdout, /7d /);
  assert.match(stdout, /24%/);   // 23.5 rounds to 24
  assert.match(stdout, /41%/);
  assert.match(stdout, /↑16k/);  // 15500 -> 16k (≥10k uses integer-rounded thousand)
  assert.match(stdout, /↓1\.2k/); // 1200 -> 1.2k
  assert.match(stdout, /API≈\$0\.123/); // labelled as API-equivalent
  assert.match(stdout, /\+156/);
  assert.match(stdout, /-23/);
  assert.match(stdout, /cached/); // cache hit % present
});

test('statusline: high-usage fixture shows 95%, 88%, big tokens, API≈cost', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'high-usage.json');
  assert.equal(code, 0);
  assert.match(stdout, /Sonnet/);
  assert.match(stdout, /95%/);
  assert.match(stdout, /88%/);
  assert.match(stdout, /↑156k/);
  assert.match(stdout, /API≈\$4\.88/);
});

test('statusline: no rate_limits fixture omits 5h/7d but keeps cost+model', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-rate-limits.json');
  assert.equal(code, 0);
  assert.match(stdout, /Haiku/);
  assert.doesNotMatch(stdout, /5h /);
  assert.doesNotMatch(stdout, /7d /);
  assert.match(stdout, /API≈\$0\.0034/);
  // no token data in this fixture
  assert.doesNotMatch(stdout, /↑/);
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

test('statusline: no-cache fixture shows tokens but suppresses 0% cache hit', async () => {
  const { stdout, code } = await runScript(STATUSLINE, 'no-cache.json');
  assert.equal(code, 0);
  assert.match(stdout, /↑8\.0k/);
  assert.match(stdout, /↓600/);
  assert.doesNotMatch(stdout, /cached/);
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
