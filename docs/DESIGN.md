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
| Slash command (`commands/style.md`) | User invokes `/cc-usage-monitor:style` | conversation (previews the 10 presets via `bin/config.js preview`, saves `style`) |

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

The statusline walks the transcript too (since 0.4.0), but only when a shown
component actually needs it — the `session` segment always does, `cost`
only as a fallback when Claude Code didn't report one — so a
`CC_USAGE_MONITOR_SHOW` without those keys costs no file I/O on the hot path.

### Tertiary: bundled pricing table (`lib/pricing.js`)

`cost.total_cost_usd` is whatever Claude Code reports. When it's absent we
compute an API-equivalent figure ourselves: the transcript walker buckets
tokens **per model** (each assistant entry carries `message.model`), and
`lib/pricing.js` prices each bucket with rates verified against the live
platform.claude.com pricing page (snapshot 2026-09-02):

| Model family | Input $/MTok | Output $/MTok | Cache read $/MTok |
| --- | --- | --- | --- |
| Fable 5.1 / Mythos 5.1 | 10 | 50 | 0.25 (flat, 0.025×) |
| Fable 5 / Mythos 5 | 10 | 50 | 1 |
| Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | 5 | 25 | 0.50 |
| Opus 5 Fast / Opus 4.8 Fast | 10 | 50 | 1 |
| Opus 4.1 / 4 | 15 | 75 | 1.50 |
| Sonnet 5 | 2 | 10 | 0.20 |
| Sonnet 4.6 / 4.5 / 4 / 3.x | 3 | 15 | 0.30 |
| Opus 3 | 15 | 75 | 1.50 |
| Haiku 4.5 | 1 | 5 | 0.10 |
| Haiku 3.5 | 0.80 | 4 | 0.08 |
| Haiku 3 | 0.25 | 1.25 | 0.025 |

Cache multipliers follow the official rules and stack on fast-mode rates:
reads 0.1× input (Fable 5.1 / Mythos 5.1 are the exception at a flat
$0.25/MTok), 5-minute writes 1.25×, 1-hour writes 2× (the walker reads the
`usage.cache_creation.ephemeral_1h_input_tokens` breakdown when Claude Code
records it; otherwise everything is priced at the 5-minute rate, which
matches Claude Code's default TTL). Fast mode only carries a premium on
Opus 5 and Opus 4.8 — Opus 4.7 rejects it and Opus 4.6 bills it at standard
rates, so those IDs fall through to their plain rows. Every current model
includes the 1M context window at standard pricing, so no long-context
premium is modelled.

Model IDs resolve by **version-boundary matching** on a normalised ID
(lowercased, bracket suffixes like `[1m]` stripped): a registry key matches
when it appears in the ID and is not followed by a further point-version.
`fable-5` therefore matches `claude-fable-5`, `claude-fable-5[1m]` and
`anthropic.claude-fable-5`, but not `claude-fable-5-1` (own row) or a
hypothetical `claude-fable-5-2`. Eight-digit date suffixes, Vertex `@date`
and Bedrock `-v1:0` suffixes, and word suffixes like `-fast` still match.
The same registry supplies friendly display names when Claude Code omits
`model.display_name`.

Two honesty rules: a computed figure is only shown when **every** model in
the session is priced (a partial sum would silently undercount), and the
Stop-hook box labels it `(est.)` to distinguish it from a Claude
Code-reported cost. Unknown models — including unlisted point releases —
return `null`, never `0`. Fable 5.1 cut the cache-read rate by 4× while
keeping the per-token price, which is exactly the kind of change a loose
"same family, same price" guess would get wrong.

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
lib/theme.js      The 10 style presets: glyphs, widths, labels, color mode. Pure data.
lib/transcript.js Streaming JSONL walker with per-model token buckets. I/O.
bin/statusline.js Wires lib/parse + lib/format (+ lib/pricing fallback) → stdout.
bin/on-stop.js    Wires lib/parse + lib/format + lib/transcript + lib/pricing → stderr (boxed).
bin/config.js     CLI for /cc-usage-monitor:config and :style (get / set / reset / preview).
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

Those numbers describe the `classic` preset. The other nine presets in
`lib/theme.js` are partial overrides of it — bar glyphs and widths,
separator, labels, countdown / context-detail visibility, box borders and
bullet, and a color mode (`default`, `mono`: no color SGR at all with bold
past the red threshold, `badge`: background-colored pills). Both bins
resolve the theme once at startup (after `applyConfigToEnv()`, so the
`style` config key can reach it) and thread it through every renderer;
nothing is looked up per segment. `CC_USAGE_MONITOR_BAR_STYLE` overrides
the glyphs of any preset that has bars, never re-enabling them on
`minimal` (and never on `ascii`, which locks its 7-bit glyphs). An unknown
name falls back to `classic` — a typo in a shell profile must not blank the
statusline.

On top of the preset sit seven **overrides** — `sep`, `barWidth`,
`boxBarWidth`, `brackets`, `showReset`, `showCtxDetail`, `labels` — each a
config key bridged into a `CC_USAGE_MONITOR_*` variable exactly like the
other settings, and read by `resolveTheme()` after the preset and the
`barStyle` glyph override. They are the answer to "I want `detailed`'s
information with `ascii`'s characters" without a free-form theme builder:
a preset stays a tested, coherent whole, and the overrides are few enough to
validate and preview. Invalid values are dropped at render time.

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
| `manifest.test.js` | The three manifests agree on the version, CHANGELOG has a section for it, slash commands carry front-matter. |
| `pricing.test.js` | Model-ID resolution (version-boundary matching, date / Bedrock / Vertex suffixes), per-model rates incl. the flat Fable 5.1 cache-read price, cache-write TTL math, session totals, breakdown merging and incompleteness guards. |
| `models.test.js` | End-to-end 2026-09 roster: `claude-fable-5-1[1m]` naming and Fable 5.1 + Sonnet 5 pricing through both surfaces. |
| `theme.test.js` | Every preset resolves with the full shape; env precedence; `barStyle` override rules; `ascii` is 7-bit. |
| `transcript.test.js` | Walker: dedup-by-message-id, per-model buckets, missing/empty files. |
| `statusline.test.js` | Pipe each fixture into the real `bin/statusline.js`; assert stdout content, wrapping, computed-cost fallback, and one distinguishing pattern per style. |
| `on-stop.test.js`    | Same approach for the Stop hook; verify output goes to stderr, the Models breakdown, `(est.)` labelling, `CC_USAGE_MONITOR_QUIET=1`, and that every styled box stays rectangular. |

Total: 205 tests, runtime ≈ 4 s, no external deps.

## Future work

Ordered by priority (see CHANGELOG 0.8.0 review notes):

1. **Stop-hook state cache.** The documented Stop-hook input carries only
   `session_id`, `transcript_path`, `stop_reason`, `last_assistant_message`
   and a few others — no `rate_limits`, `cost`, `context_window` or
   `model`. Have the statusline persist its last payload to
   `${CLAUDE_PLUGIN_DATA}/last-state.json` and let the Stop hook read it.
   That also fixes the first-turn blank and gives cross-session memory.
2. **Terminal display width.** Box padding and wrapping measure
   `stripAnsi(s).length`, which undercounts emoji (1 code unit, 2 columns)
   and CJK. A small `lib/width.js` (East Asian Wide ranges, VS16,
   surrogate pairs) removes the last visual defect in the `emoji` preset.
3. **Bar rounding.** `bar()` rounds, so 97 % of 12 cells renders full and
   3 % renders empty; floor with a one-cell floor/ceiling guard instead.
4. **Burn-rate projection.** Transcript entries carry timestamps; with the
   cached `five_hour.used_percentage` history the statusline can say
   "at this pace the 5 h window fills in 1 h 47 m (resets in 2 h 13 m)".
5. **Subagent attribution.** Transcript entries carry `isSidechain`; bucket
   main-loop vs. subagent tokens and show a "subagents $X" bit.
6. **Wrap width.** `process.stdout.columns` is undefined under Claude Code's
   pipe, so the default falls to 160; either lower it or document
   `CC_USAGE_MONITOR_WIDTH` as required for wrapping.
7. Read the payload's `prompt_cache` object and `rate_limits.spend_limit`
   instead of deriving cache-hit % ourselves; count `server_tool_use` web
   searches ($10 / 1k) in the estimate.
8. Cap `timeUntil` (a far-future `resets_at` currently prints
   `95042d 13h`); write the config file atomically (temp + rename); add a
   GitHub Actions matrix (Node 18/20/22 × ubuntu/windows).
