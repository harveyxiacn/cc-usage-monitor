'use strict';

/**
 * Model registry: display names + pay-as-you-go API pricing.
 * Pure data + math. No I/O.
 *
 * Prices are USD per million tokens, verified against the live
 * platform.claude.com/docs/en/about-claude/pricing page (2026-09-02).
 * Cache pricing follows the official multipliers (they stack on top of
 * fast-mode pricing too):
 *   cache read       = 0.1  × input   — except Fable 5.1 / Mythos 5.1,
 *                                        which bill cache reads at a flat
 *                                        $0.25/MTok (0.025×), see `cacheRead`
 *   cache write (5m) = 1.25 × input   (Claude Code's default TTL)
 *   cache write (1h) = 2    × input
 *
 * Every current model (Fable 5.x, Opus 5 / 4.8–4.5, Sonnet 5 / 4.6) includes
 * the 1M context window at standard pricing — there is no long-context
 * premium to model.
 *
 * Matching: a key matches when it appears in the normalised model ID and is
 * NOT followed by a sub-version. So `fable-5` matches `claude-fable-5`,
 * `claude-fable-5[1m]` and `anthropic.claude-fable-5`, but not
 * `claude-fable-5-1` (which has its own row) nor a hypothetical
 * `claude-fable-5-2`. Fable 5.1 changed the cache-read rate, so a future
 * point release can't be assumed to price like its predecessor — unknown
 * beats wrong. Date suffixes (`-20251001`, 8 digits), Vertex `@20251101`
 * and Bedrock `-v1:0` suffixes, and word suffixes (`-fast`) still match.
 * Order still matters for overlapping keys: `opus-5-fast` before `opus-5`.
 */

const MODELS = [
  // Fable 5.1 / Mythos 5.1 — same per-token price as Fable 5, but cache
  // reads dropped to a flat $0.25/MTok (0.025×, a quarter of Fable 5's $1).
  // Mythos 5.1 is Project Glasswing only; the live pricing page lists it
  // with the same $0.25/MTok cache-read rate as Fable 5.1 (footnote 1).
  { key: 'fable-5-1',        name: 'Fable 5.1',      input: 10,   output: 50, cacheRead: 0.25 },
  { key: 'mythos-5-1',       name: 'Mythos 5.1',     input: 10,   output: 50, cacheRead: 0.25 },
  { key: 'fable-5',          name: 'Fable 5',        input: 10,   output: 50 },
  { key: 'mythos-5',         name: 'Mythos 5',       input: 10,   output: 50 },
  // Fast mode (research preview) — premium per-token pricing on Opus 5 and
  // Opus 4.8 only. Opus 4.7 rejects `speed: "fast"` and Opus 4.6 runs it at
  // standard speed and standard rates, so those IDs fall through to the
  // plain Opus rows below.
  { key: 'opus-5-fast',      name: 'Opus 5 Fast',    input: 10,   output: 50 },
  { key: 'opus-4-8-fast',    name: 'Opus 4.8 Fast',  input: 10,   output: 50 },
  { key: 'opus-5',           name: 'Opus 5',         input: 5,    output: 25 },
  { key: 'opus-4-8',         name: 'Opus 4.8',       input: 5,    output: 25 },
  { key: 'opus-4-7',         name: 'Opus 4.7',       input: 5,    output: 25 },
  { key: 'opus-4-6',         name: 'Opus 4.6',       input: 5,    output: 25 },
  { key: 'opus-4-5',         name: 'Opus 4.5',       input: 5,    output: 25 },
  { key: 'opus-4-1',         name: 'Opus 4.1',       input: 15,   output: 75 },
  // Opus 4 needs two rows: the claude-opus-4-0 alias (where "-0" would
  // otherwise read as a sub-version) and the bare/dated forms
  // (claude-opus-4-20250514, Vertex claude-opus-4@20250514). Thanks to the
  // version-boundary rule the second row can't swallow Opus 4.x point
  // releases — Opus pricing dropped from $15 to $5 at 4.5, so it must not.
  { key: 'opus-4-0',         name: 'Opus 4',         input: 15,   output: 75 },
  { key: 'opus-4',           name: 'Opus 4',         input: 15,   output: 75 },
  { key: '3-opus',           name: 'Opus 3',         input: 15,   output: 75 },
  // Sonnet 5 is the first Sonnet priced below $3/$15 — its $2/$10 launch
  // price became the standard price in 2026-09.
  { key: 'sonnet-5',         name: 'Sonnet 5',       input: 2,    output: 10 },
  { key: 'sonnet-4-6',       name: 'Sonnet 4.6',     input: 3,    output: 15 },
  { key: 'sonnet-4-5',       name: 'Sonnet 4.5',     input: 3,    output: 15 },
  // Same two-row shape as Opus 4. With Sonnet 5 at $2/$10, "every Sonnet is
  // $3/$15" no longer holds, so an unlisted Sonnet 4.x must stay unknown —
  // the boundary rule guarantees that while still matching the bare, dated
  // and Vertex forms of Sonnet 4 itself.
  { key: 'sonnet-4-0',       name: 'Sonnet 4',       input: 3,    output: 15 },
  { key: 'sonnet-4',         name: 'Sonnet 4',       input: 3,    output: 15 },
  { key: '3-7-sonnet',       name: 'Sonnet 3.7',     input: 3,    output: 15 },
  { key: '3-5-sonnet',       name: 'Sonnet 3.5',     input: 3,    output: 15 },
  { key: 'haiku-4-5',        name: 'Haiku 4.5',      input: 1,    output: 5 },
  { key: '3-5-haiku',        name: 'Haiku 3.5',      input: 0.8,  output: 4 },
  { key: '3-haiku',          name: 'Haiku 3',        input: 0.25, output: 1.25 },
];

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

/**
 * Lowercase and strip bracket suffixes (`[1m]` long-context markers) so the
 * key match sees a clean ID.
 */
function normalizeModelId(modelId) {
  if (typeof modelId !== 'string') return null;
  const id = modelId.toLowerCase().replace(/\[[^\]]*\]/g, '').trim();
  return id || null;
}

// What may NOT directly follow a matched key: a bare digit (`opus-4-10` vs
// key `opus-4-1`) or a hyphen + 1..7 digits (`fable-5-1` vs key `fable-5`).
// An 8-digit run is a date suffix (`-20251001`) and is fine; so is anything
// non-numeric (`-fast`, `@2025…`, `-v1:0`, end of string).
const SUBVERSION_AFTER_KEY = /^(?:\d|-\d{1,7}(?!\d))/;

/**
 * True when `key` occurs in the normalised `id` at a version boundary — i.e.
 * not as a prefix of a longer point-version. Exported for tests.
 */
function keyMatches(id, key) {
  let from = 0;
  for (;;) {
    const i = id.indexOf(key, from);
    if (i === -1) return false;
    if (!SUBVERSION_AFTER_KEY.test(id.slice(i + key.length))) return true;
    from = i + 1;
  }
}

/**
 * Resolve a model ID to its registry entry, or null when unknown.
 * Returns { key, name, pricing: { input, output, cacheRead, cacheWrite,
 * cacheWrite1h } } with all pricing in USD per million tokens.
 */
function modelInfo(modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  for (const m of MODELS) {
    if (keyMatches(id, m.key)) {
      return {
        key: m.key,
        name: m.name,
        pricing: {
          input: m.input,
          output: m.output,
          cacheRead: m.cacheRead ?? m.input * CACHE_READ_MULTIPLIER,
          cacheWrite: m.input * CACHE_WRITE_5M_MULTIPLIER,
          cacheWrite1h: m.input * CACHE_WRITE_1H_MULTIPLIER,
        },
      };
    }
  }
  return null;
}

/**
 * Friendly display name ("Fable 5.1", "Opus 5") for a model ID, or null
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
  return costForInfo(modelInfo(modelId), tokens);
}

/** costForTokens for an already-resolved registry entry (saves a re-scan). */
function costForInfo(info, tokens) {
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
 *     non-zero usage, sorted by descending cost. Raw IDs that resolve to
 *     the same display name (`claude-fable-5-1` and `claude-fable-5-1[1m]`
 *     after a mid-session context-mode switch; the alias and dated rows of
 *     Opus 4) are merged into one row, so the breakdown never lists the
 *     same model twice.
 *   - complete: false when any model with non-zero usage is missing from the
 *     pricing registry — the usd figure would be an undercount, so callers
 *     should only display it when complete is true.
 */
function sessionCost(models) {
  if (!models || typeof models !== 'object') return null;
  let usd = 0;
  let complete = true;
  let any = false;
  const byName = new Map();
  for (const [modelId, tokens] of Object.entries(models)) {
    if (!hasUsage(tokens)) continue; // zero-usage entries (e.g. <synthetic>) are free
    any = true;
    const info = modelInfo(modelId);
    const cost = costForInfo(info, tokens);
    if (cost == null) {
      complete = false;
      continue;
    }
    usd += cost;
    const row = byName.get(info.name);
    if (row) row.usd += cost;
    else byName.set(info.name, { modelId, name: info.name, usd: cost });
  }
  if (!any) return null;
  const perModel = [...byName.values()].sort((a, b) => b.usd - a.usd);
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
  keyMatches,
  modelInfo,
  modelDisplayName,
  costForTokens,
  sessionCost,
};
