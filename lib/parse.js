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
 * Pull rate-limit, cost, and model info out of the Claude Code statusline JSON.
 * Returns `{ fiveH, sevenD, cost, model, contextPct }` — any missing piece is null.
 */
function extractUsage(payload) {
  const out = {
    fiveH: null,        // { used, resetsAt }
    sevenD: null,       // { used, resetsAt }
    cost: null,         // total_cost_usd
    linesAdded: null,
    linesRemoved: null,
    model: null,
    contextPct: null,
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

  if (payload.context_window && typeof payload.context_window === 'object') {
    out.contextPct = numOrNull(payload.context_window.used_percentage);
  }

  return out;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { readStdinJson, extractUsage };
