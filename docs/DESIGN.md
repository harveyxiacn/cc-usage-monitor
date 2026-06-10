# Design

## Goals

1. Surface the two rolling rate-limit windows Anthropic enforces on Claude
   Pro / Max accounts (5-hour and 7-day) at a glance.
2. Show a compact summary in the Claude Code CLI after **every task**, so
   users notice creeping usage before they hit a wall.
3. Stay zero-dependency, cross-platform, and absolutely silent on failure —
   a usage monitor that crashes the host shell is worse than no monitor.

## Non-goals

- Replacing [`ccusage`](https://github.com/ryoppippi/ccusage). For deep
  historical analysis we shell out to `ccusage` from the slash command.
- Predicting quota. We display what Claude Code reports; we don't extrapolate.
- Sending data anywhere. There is no telemetry, no analytics, no network.

## Surfaces

| Surface | When it runs | Output stream |
| --- | --- | --- |
| Statusline (`bin/statusline.js`) | Every assistant turn | stdout, single line |
| Stop hook (`bin/on-stop.js`)     | When Claude finishes a task | stderr, multi-line box |
| Slash command (`commands/usage.md`) | User invokes `/cc-usage-monitor:usage` | conversation |
| Slash command (`commands/config.md`) | User invokes `/cc-usage-monitor:config` | conversation (writes config file via `bin/config.js`) |

The statusline runs **constantly**, so it does no shell-outs and only two
tightly bounded filesystem reads: the small config file (one read,
try/catch-guarded) and the transcript walk for session totals (watchdog +
size cap; skippable via `CC_USAGE_MONITOR_NO_SESSION=1`). The Stop hook runs
**after each task**, which is infrequent enough that we could shell out to
`ccusage`, but in practice we don't need to: the same JSON shape is
delivered to both surfaces.

## Data sources

### Primary: stdin JSON from Claude Code

Both `statusline.js` and `on-stop.js` are invoked by Claude Code with a JSON
document on stdin. The fields we care about:

```jsonc
{
  "model": { "id": "claude-opus-4-7", "display_name": "Opus" },
  "cost": {
    "total_cost_usd": 0.12,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": { "used_percentage": 12 },
  "rate_limits": {
    "five_hour":  { "used_percentage": 23.5, "resets_at": 1738425600 },
    "seven_day":  { "used_percentage": 41.2, "resets_at": 1738857600 }
  }
}
```

`rate_limits` is **only present for Pro/Max subscribers** after the first API
response. Anonymous API key users will not see it; we degrade gracefully and
still show cost + model.

We also extract:

- `context_window.total_input_tokens` — current loaded context size.
- `context_window.total_output_tokens` — most recent assistant turn output.
- `context_window.current_usage.{input,cache_creation,cache_read}_tokens` —
  used to compute the cache-hit percentage on the latest turn.

`cost.total_cost_usd` is rendered as `API≈$X.XX` to make it explicit that
the figure is API-equivalent dollars rather than your flat subscription
cost. Pro/Max users typically see API≈ many multiples of their monthly fee
once they're using Claude Code heavily; the label makes the value of the
plan visible.

The statusline tokens reflect the **latest turn / current context**.
Session-cumulative totals (in the Stop hook only) come from the transcript
walker — see "Secondary: transcript JSONL" above.

### Secondary: transcript JSONL

Both surfaces walk the session transcript JSONL on disk to compute
session-cumulative tokens (the statusline since 0.4.0; skip it there with
`CC_USAGE_MONITOR_NO_SESSION=1`). Path comes from `payload.transcript_path`
in the incoming JSON.

Critical detail: Claude Code logs each assistant message **multiple times**,
once per content block (thinking, text, tool_use). Naively summing
`message.usage` across all assistant entries triple-counts. We dedupe by
`message.id` (the Anthropic API response ID, unique per response).

The walker has a 50 MB safety cap, a 1500 ms watchdog timeout, and silently
returns `null` on missing/unreadable files so the Stop hook never blocks
Claude Code.

We don't walk the transcript from the statusline because it fires on every
turn — file I/O on the hot path is unnecessary risk.

### Tertiary: bundled pricing table (`lib/pricing.js`)

`cost.total_cost_usd` is whatever Claude Code reports. When it's absent we
compute an API-equivalent figure ourselves: the transcript walker buckets
tokens **per model** (each assistant entry carries `message.model`), and
`lib/pricing.js` prices each bucket with rates verified against the live
platform.claude.com pricing page (snapshot 2026-06):

| Model family | Input $/MTok | Output $/MTok |
| --- | --- | --- |
| Fable 5 / Mythos 5 | 10 | 50 |
| Opus 4.8 / 4.7 / 4.6 / 4.5 | 5 | 25 |
| Opus 4.8 Fast | 10 | 50 |
| Opus 4.7 / 4.6 Fast | 30 | 150 |
| Opus 4.1 / 4 | 15 | 75 |
| Sonnet 4.x / 3.x | 3 | 15 |
| Opus 3 | 15 | 75 |
| Haiku 4.5 | 1 | 5 |
| Haiku 3.5 | 0.80 | 4 |
| Haiku 3 | 0.25 | 1.25 |

Cache multipliers follow the official rules and stack on fast-mode rates:
reads 0.1× input, 5-minute writes 1.25×, 1-hour writes 2× (the walker reads
the `usage.cache_creation.ephemeral_1h_input_tokens` breakdown when Claude
Code records it; otherwise everything is priced at the 5-minute rate, which
matches Claude Code's default TTL). The 1M context window on Fable 5 /
Opus 4.8–4.6 / Sonnet 4.6 carries no long-context premium, so none is
modelled.

Model IDs resolve by substring on a normalised ID (lowercased, bracket
suffixes like `[1m]` stripped), so date-suffixed and Bedrock-prefixed IDs
match too. The same registry supplies friendly display names when Claude
Code omits `model.display_name`.

Two honesty rules: a computed figure is only shown when **every** model in
the session is priced (a partial sum would silently undercount), and the
Stop-hook box labels it `(est.)` to distinguish it from a Claude
Code-reported cost. Unknown models return `null`, never `0`.

### Fallback: ccusage (slash command only)

The `/cc-usage-monitor:usage` slash command shells out to
`npx ccusage@latest blocks --active --json` for the live 5-hour block, plus a
7-day daily query summed locally. This path is invoked **only** when the user
explicitly runs the command — not in the statusline or hook.

## Module layout

```
lib/format.js     Pure formatters (bar, color, time, cost, tokens). No I/O.
lib/parse.js      Stdin reader + JSON shape extractor. No formatting.
lib/pricing.js    Model registry: display names + per-MTok pricing. Pure data + math.
lib/config.js     Persistent user config (~/.claude/cc-usage-monitor.json). Small I/O.
lib/transcript.js Streaming JSONL walker with per-model token buckets. I/O.
bin/statusline.js Wires lib/parse + lib/format (+ lib/pricing fallback) → stdout.
bin/on-stop.js    Wires lib/parse + lib/format + lib/transcript + lib/pricing → stderr (boxed).
bin/config.js     CLI for /cc-usage-monitor:config (get / set / reset).
```

The config file bridges into the existing env-var interface: at process
start, `applyConfigToEnv()` fills in any `CC_USAGE_MONITOR_*` variable that
isn't already set. Env vars therefore always win, the file is read exactly
once per spawn (one small read, try/catch-guarded), and the rest of the code
keeps a single configuration surface.

Pure-vs-impure split lets us unit-test formatters trivially while still
having end-to-end tests that spawn the real scripts with fixture stdin.

## Rendering rules

| Percentage | Color  |
| ---------- | ------ |
| < 70 %     | green  |
| 70–90 %    | yellow |
| ≥ 90 %     | red    |
| null       | gray (rendered as dashes) |

Bar width:

- Statusline: 5 cells (compact, fits in tight terminals)
- Stop hook box: 12 cells (slightly more headroom inside the box)

The Stop-hook box is at least 60 columns wide inside, growing to fit the
longest row so the right border always lines up.

Time-until-reset: `Xd Yh` if ≥ 1 day, `Xh Ym` if ≥ 1 hour, else `Xm`. Past
resets render as `now`.

Cost formatting:

- Sub-cent (< 0.01 USD): 4 decimals, e.g. `$0.0034`
- Sub-dollar (< 1 USD): 3 decimals, e.g. `$0.123`
- ≥ 1 USD: 2 decimals, e.g. `$4.88`

## Failure modes

The statusline and Stop hook **must never** raise an exception that propagates
back to Claude Code. We wrap `main()` in `.catch(...)` and silently exit with
no output rather than risk breaking the host.

Stdin handling has a 1500 ms watchdog — if Claude Code somehow opens stdin
but never closes it, we resolve with whatever we have (or null) and exit.

JSON parse failures resolve as `null`, which leads to the friendly
`waiting for first turn…` message in the statusline and a no-op in the Stop
hook (we don't print empty boxes).

## Testing strategy

| Test layer | What we verify |
| ---------- | -------------- |
| `format.test.js` | Pure formatters: bar widths, time math, cost rounding, color buckets. |
| `pricing.test.js` | Model-ID resolution (suffixes, prefixes, specificity ordering), per-model rates, cache-write TTL math, session totals and incompleteness guards. |
| `transcript.test.js` | Walker: dedup-by-message-id, per-model buckets, missing/empty files. |
| `statusline.test.js` | Pipe each fixture into the real `bin/statusline.js`; assert stdout content, wrapping, and computed-cost fallback. |
| `on-stop.test.js`    | Same approach for the Stop hook; verify output goes to stderr, the Models breakdown, `(est.)` labelling, and `CC_USAGE_MONITOR_QUIET=1`. |

Total: 90 tests, runtime ≈ 1 s, no external deps.

## Future work

- Cache the last-seen `rate_limits` in `${CLAUDE_PLUGIN_DATA}` so the
  statusline can show stale-but-non-empty data on the first turn of a fresh
  session.
- Optional Slack / desktop notification when the 7-day window crosses 90 %.
- A `/cc-usage-monitor:reset` command that opens the Anthropic billing page.
- Plan-aware projection: if the user tells us their tier (`pro`, `max-5x`,
  `max-20x`) we can show "≈ N hours of Sonnet remaining" instead of just
  percentages.
