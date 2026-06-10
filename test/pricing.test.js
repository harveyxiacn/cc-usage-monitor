'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeModelId,
  modelInfo,
  modelDisplayName,
  costForTokens,
  sessionCost,
} = require('../lib/pricing');

test('modelDisplayName: maps Fable 5 IDs, including [1m] long-context suffix', () => {
  assert.equal(modelDisplayName('claude-fable-5'), 'Fable 5');
  assert.equal(modelDisplayName('claude-fable-5[1m]'), 'Fable 5');
});

test('modelDisplayName: maps current Opus / Sonnet / Haiku IDs', () => {
  assert.equal(modelDisplayName('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelDisplayName('claude-opus-4-7'), 'Opus 4.7');
  assert.equal(modelDisplayName('claude-sonnet-4-6'), 'Sonnet 4.6');
  assert.equal(modelDisplayName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('modelDisplayName: specific versions win over generic prefixes', () => {
  // "claude-opus-4-5..." contains "opus-4" too — must resolve to 4.5, not 4.
  assert.equal(modelDisplayName('claude-opus-4-5-20251101'), 'Opus 4.5');
  assert.equal(modelDisplayName('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelDisplayName('claude-opus-4-0'), 'Opus 4');
});

test('modelDisplayName: a future unlisted Opus 4.x is unknown, not mispriced as Opus 4', () => {
  // Opus pricing dropped $15 → $5 at 4.5, so guessing would be wrong by 3×.
  assert.equal(modelDisplayName('claude-opus-4-9'), null);
});

test('modelDisplayName: legacy date-suffixed IDs resolve to the right generation', () => {
  assert.equal(modelDisplayName('claude-3-opus-20240229'), 'Opus 3');
  assert.equal(modelDisplayName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(modelDisplayName('claude-3-7-sonnet-20250219'), 'Sonnet 3.7');
  assert.equal(modelDisplayName('claude-3-5-haiku-20241022'), 'Haiku 3.5');
  assert.equal(modelDisplayName('claude-3-haiku-20240307'), 'Haiku 3');
});

test('modelDisplayName: handles Bedrock-style provider prefixes', () => {
  assert.equal(modelDisplayName('anthropic.claude-fable-5'), 'Fable 5');
});

test('modelDisplayName: unknown model returns null', () => {
  assert.equal(modelDisplayName('gpt-4o'), null);
  assert.equal(modelDisplayName('<synthetic>'), null);
  assert.equal(modelDisplayName(null), null);
});

test('normalizeModelId: lowercases and strips bracket suffixes', () => {
  assert.equal(normalizeModelId('Claude-Fable-5[1m]'), 'claude-fable-5');
  assert.equal(normalizeModelId(''), null);
  assert.equal(normalizeModelId(42), null);
});

test('modelInfo: Fable 5 pricing is $10/$50 with standard cache multipliers', () => {
  const info = modelInfo('claude-fable-5[1m]');
  assert.equal(info.pricing.input, 10);
  assert.equal(info.pricing.output, 50);
  assert.equal(info.pricing.cacheRead, 1);      // 0.1 × input
  assert.equal(info.pricing.cacheWrite, 12.5);  // 1.25 × input
});

test('costForTokens: Fable 5 bucket math', () => {
  const usd = costForTokens('claude-fable-5', {
    inputTokens: 150,
    outputTokens: 1200,
    cacheReadTokens: 2100,
    cacheCreationTokens: 2100,
  });
  // 150×$10 + 1200×$50 + 2100×$1 + 2100×$12.5 per MTok
  assert.ok(Math.abs(usd - 0.08985) < 1e-9, `got ${usd}`);
});

test('costForTokens: unknown model returns null, never zero', () => {
  assert.equal(costForTokens('some-future-model', { inputTokens: 1000 }), null);
});

test('modelInfo: Mythos 5 priced like Fable 5; fast-mode Opus carries its premium', () => {
  assert.equal(modelDisplayName('claude-mythos-5'), 'Mythos 5');
  assert.equal(modelInfo('claude-mythos-5').pricing.input, 10);
  // Fast mode: Opus 4.8 Fast $10/$50, Opus 4.6 Fast $30/$150. The -fast key
  // must win over the plain opus-4-x prefix.
  const fast48 = modelInfo('claude-opus-4-8-fast');
  assert.equal(fast48.name, 'Opus 4.8 Fast');
  assert.equal(fast48.pricing.input, 10);
  assert.equal(fast48.pricing.output, 50);
  const fast46 = modelInfo('claude-opus-4-6-fast');
  assert.equal(fast46.pricing.input, 30);
  assert.equal(fast46.pricing.output, 150);
  // Cache multipliers stack on top of fast-mode pricing.
  assert.equal(fast46.pricing.cacheRead, 3);
  assert.equal(fast46.pricing.cacheWrite, 37.5);
});

test('costForTokens: 1-hour cache writes are billed at 2× input, 5m remainder at 1.25×', () => {
  // 1000 total write tokens on Fable 5, 400 of them with the 1h TTL:
  //   600 × $12.5 + 400 × $20 per MTok = 0.0075 + 0.008 = $0.0155
  const usd = costForTokens('claude-fable-5', {
    cacheCreationTokens: 1000,
    cacheCreation1hTokens: 400,
  });
  assert.ok(Math.abs(usd - 0.0155) < 1e-9, `got ${usd}`);
  // Without the breakdown, everything is priced at the 5m rate.
  const usd5m = costForTokens('claude-fable-5', { cacheCreationTokens: 1000 });
  assert.ok(Math.abs(usd5m - 0.0125) < 1e-9, `got ${usd5m}`);
});

test('costForTokens: 1h breakdown without a legacy total is still billed, not dropped', () => {
  const usd = costForTokens('claude-fable-5', { cacheCreation1hTokens: 500 });
  assert.ok(Math.abs(usd - 0.01) < 1e-9, `got ${usd}`); // 500 × $20 per MTok
});

test('sessionCost: a bucket with only 1h cache writes counts as usage', () => {
  const result = sessionCost({
    'claude-fable-5': { cacheCreation1hTokens: 500 },
  });
  assert.ok(result, 'expected a result');
  assert.equal(result.complete, true);
  assert.ok(Math.abs(result.usd - 0.01) < 1e-9, `got ${result.usd}`);
});

test('sessionCost: sums across models and sorts breakdown by cost desc', () => {
  const result = sessionCost({
    'claude-haiku-4-5-20251001': {
      inputTokens: 1200, outputTokens: 2000, cacheReadTokens: 0, cacheCreationTokens: 0,
    },
    'claude-fable-5': {
      inputTokens: 150, outputTokens: 1200, cacheReadTokens: 2100, cacheCreationTokens: 2100,
    },
  });
  assert.equal(result.complete, true);
  assert.ok(Math.abs(result.usd - 0.10105) < 1e-9, `got ${result.usd}`);
  assert.equal(result.perModel.length, 2);
  assert.equal(result.perModel[0].name, 'Fable 5'); // 0.08985 > 0.0112
  assert.equal(result.perModel[1].name, 'Haiku 4.5');
});

test('sessionCost: unknown model with usage marks the total incomplete', () => {
  const result = sessionCost({
    'claude-fable-5': { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'mystery-model': { inputTokens: 9999, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  });
  assert.equal(result.complete, false);
});

test('sessionCost: zero-usage models (e.g. <synthetic>) are ignored', () => {
  const result = sessionCost({
    'claude-fable-5': { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    '<synthetic>': { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  });
  assert.equal(result.complete, true);
  assert.equal(result.perModel.length, 1);
});

test('sessionCost: empty or missing map returns null', () => {
  assert.equal(sessionCost(null), null);
  assert.equal(sessionCost({}), null);
});
