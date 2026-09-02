'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeModelId,
  keyMatches,
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

test('modelInfo: Mythos 5 priced like Fable 5; fast-mode Opus 5 / 4.8 carry the premium', () => {
  assert.equal(modelDisplayName('claude-mythos-5'), 'Mythos 5');
  assert.equal(modelInfo('claude-mythos-5').pricing.input, 10);
  // Fast mode is $10/$50 on Opus 5 and Opus 4.8. The -fast key must win
  // over the plain opus-N prefix.
  for (const [id, name] of [['claude-opus-5-fast', 'Opus 5 Fast'], ['claude-opus-4-8-fast', 'Opus 4.8 Fast']]) {
    const fast = modelInfo(id);
    assert.equal(fast.name, name);
    assert.equal(fast.pricing.input, 10);
    assert.equal(fast.pricing.output, 50);
    // Cache multipliers stack on top of fast-mode pricing.
    assert.equal(fast.pricing.cacheRead, 1);
    assert.equal(fast.pricing.cacheWrite, 12.5);
  }
  // Opus 4.6 runs `speed: "fast"` at standard speed and standard rates, and
  // Opus 4.7 rejects it outright — neither has a premium row any more, so a
  // -fast ID falls through to the plain model.
  assert.equal(modelInfo('claude-opus-4-6-fast').name, 'Opus 4.6');
  assert.equal(modelInfo('claude-opus-4-6-fast').pricing.input, 5);
  assert.equal(modelInfo('claude-opus-4-7-fast').name, 'Opus 4.7');
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

test('modelDisplayName: Fable 5.1 IDs resolve to their own row, not Fable 5', () => {
  assert.equal(modelDisplayName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelDisplayName('claude-fable-5-1[1m]'), 'Fable 5.1');
  assert.equal(modelDisplayName('anthropic.claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelDisplayName('claude-mythos-5-1'), 'Mythos 5.1');
  // Fable 5 still resolves on its own.
  assert.equal(modelDisplayName('claude-fable-5'), 'Fable 5');
});

test('modelInfo: Fable 5.1 cache reads are a flat $0.25/MTok; writes keep the standard multipliers', () => {
  const info = modelInfo('claude-fable-5-1[1m]');
  assert.equal(info.pricing.input, 10);
  assert.equal(info.pricing.output, 50);
  assert.equal(info.pricing.cacheRead, 0.25);     // 0.025 × input — a quarter of Fable 5's $1
  assert.equal(info.pricing.cacheWrite, 12.5);    // 1.25 × input
  assert.equal(info.pricing.cacheWrite1h, 20);    // 2 × input
  assert.equal(modelInfo('claude-mythos-5-1').pricing.cacheRead, 0.25);
  // Fable 5 is unchanged.
  assert.equal(modelInfo('claude-fable-5').pricing.cacheRead, 1);
});

test('costForTokens: Fable 5.1 bucket math uses the cheaper cache-read rate', () => {
  const tokens = { inputTokens: 150, outputTokens: 1200, cacheReadTokens: 2100, cacheCreationTokens: 2100 };
  // 150×$10 + 1200×$50 + 2100×$0.25 + 2100×$12.5 per MTok
  const usd = costForTokens('claude-fable-5-1', tokens);
  assert.ok(Math.abs(usd - 0.088275) < 1e-9, `got ${usd}`);
  // Same tokens on Fable 5 cost more because of the $1 cache reads.
  const usd5 = costForTokens('claude-fable-5', tokens);
  assert.ok(Math.abs(usd5 - 0.08985) < 1e-9, `got ${usd5}`);
});

test('modelInfo: Opus 5 is $5/$25 and Sonnet 5 is $2/$10', () => {
  const opus = modelInfo('claude-opus-5');
  assert.equal(opus.name, 'Opus 5');
  assert.equal(opus.pricing.input, 5);
  assert.equal(opus.pricing.output, 25);
  assert.equal(opus.pricing.cacheRead, 0.5);
  const sonnet = modelInfo('claude-sonnet-5');
  assert.equal(sonnet.name, 'Sonnet 5');
  assert.equal(sonnet.pricing.input, 2);
  assert.equal(sonnet.pricing.output, 10);
  assert.equal(sonnet.pricing.cacheRead, 0.2);
  assert.equal(sonnet.pricing.cacheWrite, 2.5);
  assert.equal(sonnet.pricing.cacheWrite1h, 4);
});

test('modelDisplayName: unlisted point releases are unknown rather than mispriced', () => {
  // Each of these would silently inherit its predecessor's rates under a
  // plain substring match. Fable 5.1 already changed cache pricing once.
  assert.equal(modelDisplayName('claude-fable-5-2'), null);
  assert.equal(modelDisplayName('claude-opus-5-1'), null);
  assert.equal(modelDisplayName('claude-sonnet-5-1'), null);
  assert.equal(modelDisplayName('claude-sonnet-4-7'), null);
  assert.equal(modelDisplayName('claude-opus-4-10'), null);
});

test('modelDisplayName: Sonnet 4 is pinned to its two real IDs', () => {
  assert.equal(modelDisplayName('claude-sonnet-4-0'), 'Sonnet 4');
  assert.equal(modelDisplayName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(modelDisplayName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelDisplayName('claude-sonnet-4-6'), 'Sonnet 4.6');
});

test('modelDisplayName: Bedrock and Vertex ID shapes still resolve', () => {
  assert.equal(modelDisplayName('us.anthropic.claude-opus-4-5-20251101-v1:0'), 'Opus 4.5');
  assert.equal(modelDisplayName('claude-opus-4-5@20251101'), 'Opus 4.5');
  assert.equal(modelDisplayName('anthropic.claude-sonnet-5'), 'Sonnet 5');
});

test('keyMatches: version-boundary rules', () => {
  assert.equal(keyMatches('claude-fable-5', 'fable-5'), true);
  assert.equal(keyMatches('claude-fable-5-1', 'fable-5'), false);       // sub-version
  assert.equal(keyMatches('claude-fable-5-1', 'fable-5-1'), true);
  assert.equal(keyMatches('claude-haiku-4-5-20251001', 'haiku-4-5'), true); // 8-digit date
  assert.equal(keyMatches('claude-opus-4-8-fast', 'opus-4-8'), true);   // word suffix
  assert.equal(keyMatches('claude-opus-4-10', 'opus-4-1'), false);      // bare digit
  assert.equal(keyMatches('claude-opus-4-20250514', 'opus-4-20250514'), true);
  assert.equal(keyMatches('claude-opus-4-5@20251101', 'opus-4-5'), true);
  assert.equal(keyMatches('claude-sonnet-4-6', 'sonnet-5'), false);     // not a substring at all
});

test('sessionCost: raw IDs that resolve to the same model are merged into one breakdown row', () => {
  // A mid-session context-mode switch can log the same model under two raw
  // IDs; the Models row must not list "Fable 5.1" twice.
  const result = sessionCost({
    'claude-fable-5-1': { inputTokens: 100, outputTokens: 1000 },
    'claude-fable-5-1[1m]': { inputTokens: 100, outputTokens: 1000 },
    'claude-sonnet-5': { inputTokens: 1000, outputTokens: 0 },
  });
  assert.equal(result.complete, true);
  assert.equal(result.perModel.length, 2);
  assert.equal(result.perModel[0].name, 'Fable 5.1');
  // 2 × (100×$10 + 1000×$50) per MTok = 2 × $0.051 = $0.102
  assert.ok(Math.abs(result.perModel[0].usd - 0.102) < 1e-9, `got ${result.perModel[0].usd}`);
  assert.equal(result.perModel[1].name, 'Sonnet 5');
  assert.ok(Math.abs(result.usd - 0.104) < 1e-9, `got ${result.usd}`);
});

test('modelDisplayName: bare, dated and Vertex forms of Sonnet 4 / Opus 4 resolve; 4.x point releases stay unknown', () => {
  assert.equal(modelDisplayName('claude-sonnet-4'), 'Sonnet 4');
  assert.equal(modelDisplayName('claude-sonnet-4@20250514'), 'Sonnet 4');
  assert.equal(modelDisplayName('claude-opus-4@20250514'), 'Opus 4');
  assert.equal(modelDisplayName('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelDisplayName('claude-sonnet-4-7'), null);
  assert.equal(modelDisplayName('claude-opus-4-9'), null);
});

test('sessionCost: alias and dated rows of the same model merge into one breakdown row', () => {
  const result = sessionCost({
    'claude-opus-4-0': { inputTokens: 1000, outputTokens: 1000 },
    'claude-opus-4-20250514': { inputTokens: 1000, outputTokens: 1000 },
  });
  assert.equal(result.perModel.length, 1);
  assert.equal(result.perModel[0].name, 'Opus 4');
  // 2 × (1000×$15 + 1000×$75) per MTok = $0.18
  assert.ok(Math.abs(result.perModel[0].usd - 0.18) < 1e-9, `got ${result.perModel[0].usd}`);
});
