'use strict';

/**
 * Model registry: display names + pay-as-you-go API pricing.
 * Pure data + math. No I/O.
 *
 * Prices are USD per million tokens, verified against the live
 * platform.claude.com/docs/en/about-claude/pricing page (2026-06).
 * Cache pricing follows the official multipliers (they stack on top of
 * fast-mode pricing too):
 *   cache read       = 0.1  × input
 *   cache write (5m) = 1.25 × input  (Claude Code's default TTL)
 *   cache write (1h) = 2    × input
 *
 * Fable 5 / Mythos 5 / Opus 4.8–4.6 / Sonnet 4.6 include the 1M context
 * window at standard pricing — there is no long-context premium to model.
 *
 * Matching is by substring on the normalised model ID, so date-suffixed IDs
 * (`claude-haiku-4-5-20251001`), provider-prefixed IDs (`anthropic.claude-…`
 * on Bedrock) and bracket-suffixed IDs (`claude-fable-5[1m]`) all resolve.
 * Order matters: more specific keys must come before their prefixes
 * (`opus-4-6-fast` before `opus-4-6` before `opus-4`).
 */

const MODELS = [
  { key: 'fable-5',         name: 'Fable 5',        input: 10,   output: 50 },
  { key: 'mythos-5',        name: 'Mythos 5',       input: 10,   output: 50 },
  // Fast mode (research preview) — premium per-token pricing, Opus only.
  { key: 'opus-4-8-fast',   name: 'Opus 4.8 Fast',  input: 10,   output: 50 },
  { key: 'opus-4-7-fast',   name: 'Opus 4.7 Fast',  input: 30,   output: 150 },
  { key: 'opus-4-6-fast',   name: 'Opus 4.6 Fast',  input: 30,   output: 150 },
  { key: 'opus-4-8',        name: 'Opus 4.8',       input: 5,    output: 25 },
  { key: 'opus-4-7',        name: 'Opus 4.7',       input: 5,    output: 25 },
  { key: 'opus-4-6',        name: 'Opus 4.6',       input: 5,    output: 25 },
  { key: 'opus-4-5',        name: 'Opus 4.5',       input: 5,    output: 25 },
  { key: 'opus-4-1',        name: 'Opus 4.1',       input: 15,   output: 75 },
  // Opus 4 is pinned to its two real IDs (claude-opus-4-0 alias and the
  // claude-opus-4-20250514 full ID) instead of a bare 'opus-4' catch-all:
  // Opus pricing dropped from $15 to $5 at 4.5, so a catch-all would
  // misprice future Opus 4.x IDs at the old rate. Unknown beats wrong.
  { key: 'opus-4-0',        name: 'Opus 4',         input: 15,   output: 75 },
  { key: 'opus-4-2025',     name: 'Opus 4',         input: 15,   output: 75 },
  { key: '3-opus',          name: 'Opus 3',         input: 15,   output: 75 },
  { key: 'sonnet-4-6',      name: 'Sonnet 4.6',     input: 3,    output: 15 },
  { key: 'sonnet-4-5',      name: 'Sonnet 4.5',     input: 3,    output: 15 },
  // 'sonnet-4' stays a catch-all deliberately: every Sonnet generation has
  // been $3/$15, so a future Sonnet 4.x most likely prices the same.
  { key: 'sonnet-4',        name: 'Sonnet 4',       input: 3,    output: 15 },
  { key: '3-7-sonnet',      name: 'Sonnet 3.7',     input: 3,    output: 15 },
  { key: '3-5-sonnet',      name: 'Sonnet 3.5',     input: 3,    output: 15 },
  { key: 'haiku-4-5',       name: 'Haiku 4.5',      input: 1,    output: 5 },
  { key: '3-5-haiku',       name: 'Haiku 3.5',      input: 0.8,  output: 4 },
  { key: '3-haiku',         name: 'Haiku 3',        input: 0.25, output: 1.25 },
];

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

/**
 * Lowercase and strip bracket suffixes (`[1m]` long-context markers) so the
 * substring match sees a clean ID.
 */
function normalizeModelId(modelId) {
  if (typeof modelId !== 'string') return null;
  const id = modelId.toLowerCase().replace(/\[[^\]]*\]/g, '').trim();
  return id || null;
}

/**
 * Resolve a model ID to its registry entry, or null when unknown.
 * Returns { key, name, pricing: { input, output, cacheRead, cacheWrite } }
 * with all pricing in USD per million tokens.
 */
function modelInfo(modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  for (const m of MODELS) {
    if (id.includes(m.key)) {
      return {
        key: m.key,
        name: m.name,
        pricing: {
          input: m.input,
          output: m.output,
          cacheRead: m.input * CACHE_READ_MULTIPLIER,
          cacheWrite: m.input * CACHE_WRITE_5M_MULTIPLIER,
          cacheWrite1h: m.input * CACHE_WRITE_1H_MULTIPLIER,
        },
      };
    }
  }
  return null;
}

/**
 * Friendly display name ("Fable 5", "Opus 4.8") for a model ID, or null
 * when the model isn't in the registry.
 */
function modelDisplayName(modelId) {
  const info = modelInfo(modelId);
  return info ? info.name : null;
}

/**
 * API-equivalent USD cost for one token bucket on one model.
 * Returns null when the model is unknown — callers must not treat unknown
 * as free.
 *
 * `cacheCreationTokens` is the total cache-write count; the optional
 * `cacheCreation1hTokens` subset (from `usage.cache_creation.
 * ephemeral_1h_input_tokens` when Claude Code records it) is billed at the
 * 2× 1-hour rate, the remainder at the 1.25× 5-minute rate.
 */
function costForTokens(modelId, tokens) {
  const info = modelInfo(modelId);
  if (!info || !tokens || typeof tokens !== 'object') return null;
  const p = info.pricing;
  const write1h = toNum(tokens.cacheCreation1hTokens);
  // The 1h subset is normally ≤ the total, but if a payload ever carries
  // the breakdown without the legacy total, don't silently drop it.
  const writeTotal = Math.max(toNum(tokens.cacheCreationTokens), write1h);
  const write5m = writeTotal - write1h;
  const usd =
    (toNum(tokens.inputTokens) * p.input
      + toNum(tokens.outputTokens) * p.output
      + toNum(tokens.cacheReadTokens) * p.cacheRead
      + write5m * p.cacheWrite
      + write1h * p.cacheWrite1h) / 1_000_000;
  return Number.isFinite(usd) ? usd : null;
}

/**
 * Total API-equivalent cost for a per-model token map (the `models` field
 * produced by lib/transcript.js).
 *
 * Returns { usd, complete, perModel } or null when there is nothing to price.
 *   - perModel: [{ modelId, name, usd }] for every priced model with
 *     non-zero usage, sorted by descending cost.
 *   - complete: false when any model with non-zero usage is missing from the
 *     pricing registry — the usd figure would be an undercount, so callers
 *     should only display it when complete is true.
 */
function sessionCost(models) {
  if (!models || typeof models !== 'object') return null;
  let usd = 0;
  let complete = true;
  let any = false;
  const perModel = [];
  for (const [modelId, tokens] of Object.entries(models)) {
    if (!hasUsage(tokens)) continue; // zero-usage entries (e.g. <synthetic>) are free
    any = true;
    const cost = costForTokens(modelId, tokens);
    if (cost == null) {
      complete = false;
      continue;
    }
    usd += cost;
    perModel.push({ modelId, name: modelDisplayName(modelId), usd: cost });
  }
  if (!any) return null;
  perModel.sort((a, b) => b.usd - a.usd);
  return { usd, complete, perModel };
}

function hasUsage(tokens) {
  if (!tokens || typeof tokens !== 'object') return false;
  return toNum(tokens.inputTokens) > 0
    || toNum(tokens.outputTokens) > 0
    || toNum(tokens.cacheReadTokens) > 0
    || toNum(tokens.cacheCreationTokens) > 0
    || toNum(tokens.cacheCreation1hTokens) > 0;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  MODELS,
  normalizeModelId,
  modelInfo,
  modelDisplayName,
  costForTokens,
  sessionCost,
};
