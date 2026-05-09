'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bar,
  timeUntil,
  formatCost,
  formatTokens,
  pct,
  colorForPercent,
} = require('../lib/format');
const { cacheHitPercent } = require('../lib/parse');

test('bar: 0% renders all empty', () => {
  assert.equal(bar(0, 10), '▱'.repeat(10));
});

test('bar: 100% renders all filled', () => {
  assert.equal(bar(100, 10), '▰'.repeat(10));
});

test('bar: 50% on width 10 is half/half', () => {
  assert.equal(bar(50, 10), '▰'.repeat(5) + '▱'.repeat(5));
});

test('bar: clamps to 0..100', () => {
  assert.equal(bar(-5, 4), '▱'.repeat(4));
  assert.equal(bar(150, 4), '▰'.repeat(4));
});

test('bar: null renders dashes (unknown state)', () => {
  assert.equal(bar(null, 6), '──────');
});

test('timeUntil: future returns "Xd Yh" or "Xh Ym"', () => {
  const now = 1_700_000_000_000; // fixed clock
  // 2 days, 3 hours from now
  const future1 = (now / 1000) + 2 * 86400 + 3 * 3600;
  assert.equal(timeUntil(future1, now), '2d 3h');
  // 4 hours 12 minutes from now
  const future2 = (now / 1000) + 4 * 3600 + 12 * 60;
  assert.equal(timeUntil(future2, now), '4h 12m');
  // 35 minutes from now
  const future3 = (now / 1000) + 35 * 60;
  assert.equal(timeUntil(future3, now), '35m');
});

test('timeUntil: past returns "now"', () => {
  const now = 1_700_000_000_000;
  const past = (now / 1000) - 60;
  assert.equal(timeUntil(past, now), 'now');
});

test('timeUntil: null returns null', () => {
  assert.equal(timeUntil(null), null);
});

test('formatCost: small values use 4 decimals', () => {
  assert.equal(formatCost(0.0034), '$0.0034');
});

test('formatCost: sub-dollar uses 3 decimals', () => {
  assert.equal(formatCost(0.123), '$0.123');
});

test('formatCost: dollar+ uses 2 decimals', () => {
  assert.equal(formatCost(4.875), '$4.88');
});

test('formatCost: zero is $0.00', () => {
  assert.equal(formatCost(0), '$0.00');
});

test('formatCost: null returns null', () => {
  assert.equal(formatCost(null), null);
});

test('pct: rounds to integer', () => {
  assert.equal(pct(23.5), 24);
  assert.equal(pct(23.4), 23);
});

test('colorForPercent: thresholds at 70 and 90', () => {
  assert.equal(colorForPercent(0), 'green');
  assert.equal(colorForPercent(50), 'green');
  assert.equal(colorForPercent(69.9), 'green');
  assert.equal(colorForPercent(70), 'yellow');
  assert.equal(colorForPercent(89.9), 'yellow');
  assert.equal(colorForPercent(90), 'red');
  assert.equal(colorForPercent(100), 'red');
  assert.equal(colorForPercent(null), 'gray');
});

test('formatTokens: small numbers stay as-is', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(42), '42');
  assert.equal(formatTokens(999), '999');
});

test('formatTokens: thousands use 1 decimal under 10k, integer over', () => {
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(9999), '10.0k');
  assert.equal(formatTokens(15500), '16k');
  assert.equal(formatTokens(156000), '156k');
});

test('formatTokens: millions use 1 decimal', () => {
  assert.equal(formatTokens(1_200_000), '1.2M');
  assert.equal(formatTokens(15_500_000), '15.5M');
});

test('formatTokens: null stays null', () => {
  assert.equal(formatTokens(null), null);
});

test('cacheHitPercent: full cache reads', () => {
  const u = { cacheReadTokens: 10000, cacheCreationTokens: 4000, rawInputTokens: 1500 };
  // 10000 / (10000 + 4000 + 1500) = 64.5%
  const hit = cacheHitPercent(u);
  assert.ok(hit > 64 && hit < 65, `expected ~64.5%, got ${hit}`);
});

test('cacheHitPercent: zero cache reads with input present returns 0', () => {
  const u = { cacheReadTokens: 0, cacheCreationTokens: 0, rawInputTokens: 8000 };
  assert.equal(cacheHitPercent(u), 0);
});

test('cacheHitPercent: all-null returns null', () => {
  assert.equal(cacheHitPercent({ cacheReadTokens: null, cacheCreationTokens: null, rawInputTokens: null }), null);
});
