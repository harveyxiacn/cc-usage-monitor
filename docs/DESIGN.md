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

The statusline runs **constantly** so it's pure JSON parsing — no shell-outs,
no filesystem reads. The Stop hook runs **after each task** which is
infrequent enough that we could shell out to `ccusage`, but in practice we
don't need to: the same JSON shape is delivered to both surfaces.

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

### Fallback: ccusage (slash command only)

The `/cc-usage-monitor:usage` slash command shells out to
`npx ccusage@latest blocks --active --json` for the live 5-hour block, plus a
7-day daily query summed locally. This path is invoked **only** when the user
explicitly runs the command — not in the statusline or hook.

## Module layout

```
lib/format.js   Pure formatters (bar, color, time, cost). No I/O.
lib/parse.js    Stdin reader + JSON shape extractor. No formatting.
bin/statusline.js   Wires lib/parse + lib/format → stdout.
bin/on-stop.js      Wires lib/parse + lib/format → stderr (boxed).
```

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

- Statusline: 10 cells (compact, fits in tight terminals)
- Stop hook box: 12 cells (slightly more headroom inside the box)

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
| `format.test.js` | Pure formatters: bar widths, time math, cost rounding, color buckets. 15 cases. |
| `statusline.test.js` | Pipe each fixture into the real `bin/statusline.js`; assert stdout content. 5 cases. |
| `on-stop.test.js`    | Same approach for the Stop hook; verify output goes to stderr; verify `CC_USAGE_MONITOR_QUIET=1` silences. 5 cases. |

Total: 25 tests, runtime ≈ 0.5 s, no external deps.

## Future work

- Cache the last-seen `rate_limits` in `${CLAUDE_PLUGIN_DATA}` so the
  statusline can show stale-but-non-empty data on the first turn of a fresh
  session.
- Optional Slack / desktop notification when the 7-day window crosses 90 %.
- A `/cc-usage-monitor:reset` command that opens the Anthropic billing page.
- Plan-aware projection: if the user tells us their tier (`pro`, `max-5x`,
  `max-20x`) we can show "≈ N hours of Sonnet remaining" instead of just
  percentages.
