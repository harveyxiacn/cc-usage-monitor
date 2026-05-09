'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runScript, ON_STOP } = require('./helpers');

test('on-stop: full fixture prints box on stderr', async () => {
  const { stdout, stderr, code } = await runScript(ON_STOP, 'full.json');
  assert.equal(code, 0);
  assert.equal(stdout, '', 'on-stop should not write to stdout');
  assert.match(stderr, /cc-usage-monitor/);
  assert.match(stderr, /5h window/);
  assert.match(stderr, /7d window/);
  assert.match(stderr, /24%/);
  assert.match(stderr, /41%/);
  assert.match(stderr, /Opus/);
  assert.match(stderr, /\$0\.123/);
});

test('on-stop: high-usage fixture flags both windows', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'high-usage.json');
  assert.equal(code, 0);
  assert.match(stderr, /95%/);
  assert.match(stderr, /88%/);
});

test('on-stop: no rate_limits + only cost still prints session line', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'no-rate-limits.json');
  assert.equal(code, 0);
  // Should print Session line because cost is present
  assert.match(stderr, /Session/);
  assert.match(stderr, /Haiku/);
  // Should NOT print 5h/7d window lines
  assert.doesNotMatch(stderr, /5h window/);
  assert.doesNotMatch(stderr, /7d window/);
});

test('on-stop: missing-cost fixture still prints rate-limit windows', async () => {
  const { stderr, code } = await runScript(ON_STOP, 'missing-cost.json');
  assert.equal(code, 0);
  assert.match(stderr, /5h window/);
  assert.match(stderr, /7d window/);
});

test('on-stop: CC_USAGE_MONITOR_QUIET=1 silences output', async () => {
  const { stdout, stderr, code } = await runScript(ON_STOP, 'full.json', {
    CC_USAGE_MONITOR_QUIET: '1',
  });
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
