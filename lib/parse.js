'use strict';

/**
 * Read all of stdin, parse it as JSON, and return the resulting object.
 * Resolves with `null` if stdin is empty or unparseable — callers should
 * degrade gracefully rather than crash the host process (Claude Code).
 */
function readStdinJson() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }

    let data = '';
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      if (!data.trim()) {
        settle(null);
        return;
      }
      try {
        settle(JSON.parse(data));
      } catch {
        settle(null);
      }
    });
    process.stdin.on('error', () => settle(null));

    // Safety: if stdin never closes, give up after 1500ms so the
    // statusline / hook never hangs Claude Code.
    setTimeout(() => settle(data ? safeParse(data) : null), 1500).unref();
  });
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Pull rate-limit, cost, model, and token info out of the Claude Code
 * statusline JSON. Returns a flat object with every field nullable so
 * callers can degrade gracefully when Claude Code omits sections.
 */
function extractUsage(payload) {
  const out = {
    fiveH: null,        // { used, resetsAt }
    sevenD: null,       // { used, resetsAt }
    cost: null,         // total_cost_usd (API-equivalent dollars)
    linesAdded: null,
    linesRemoved: null,
    model: null,
    contextPct: null,
    inputTokens: null,    // current loaded context size, in tokens
    outputTokens: null,   // most recent assistant turn output tokens
    cacheReadTokens: null,
    cacheCreationTokens: null,
    rawInputTokens: null, // current_usage.input_tokens (uncached portion)
  };

  if (!payload || typeof payload !== 'object') return out;

  const rl = payload.rate_limits;
  if (rl && typeof rl === 'object') {
    if (rl.five_hour && typeof rl.five_hour === 'object') {
      out.fiveH = {
        used: numOrNull(rl.five_hour.used_percentage),
        resetsAt: numOrNull(rl.five_hour.resets_at),
      };
    }
    if (rl.seven_day && typeof rl.seven_day === 'object') {
      out.sevenD = {
        used: numOrNull(rl.seven_day.used_percentage),
        resetsAt: numOrNull(rl.seven_day.resets_at),
      };
    }
  }

  if (payload.cost && typeof payload.cost === 'object') {
    out.cost = numOrNull(payload.cost.total_cost_usd);
    out.linesAdded = numOrNull(payload.cost.total_lines_added);
    out.linesRemoved = numOrNull(payload.cost.total_lines_removed);
  }

  if (payload.model && typeof payload.model === 'object') {
    out.model = payload.model.display_name || payload.model.id || null;
  }

  const ctx = payload.context_window;
  if (ctx && typeof ctx === 'object') {
    out.contextPct = numOrNull(ctx.used_percentage);
    out.inputTokens = numOrNull(ctx.total_input_tokens);
    out.outputTokens = numOrNull(ctx.total_output_tokens);
    if (ctx.current_usage && typeof ctx.current_usage === 'object') {
      out.cacheReadTokens = numOrNull(ctx.current_usage.cache_read_input_tokens);
      out.cacheCreationTokens = numOrNull(ctx.current_usage.cache_creation_input_tokens);
      out.rawInputTokens = numOrNull(ctx.current_usage.input_tokens);
    }
  }

  return out;
}

/**
 * Compute cache-hit percentage for the latest turn.
 * Returns null when we can't tell (no cache data) and 0 when there were
 * no cache reads even though we had input tokens.
 */
function cacheHitPercent(u) {
  const r = u.cacheReadTokens;
  const c = u.cacheCreationTokens;
  const i = u.rawInputTokens;
  if (r == null && c == null && i == null) return null;
  const total = (r ?? 0) + (c ?? 0) + (i ?? 0);
  if (total <= 0) return null;
  return ((r ?? 0) / total) * 100;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { readStdinJson, extractUsage, cacheHitPercent };
