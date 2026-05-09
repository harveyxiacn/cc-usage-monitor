# cc-usage-monitor

> A Claude Code plugin that puts your **5-hour** and **7-day** rate-limit usage
> in the statusline — and shows a compact summary in the CLI **after every
> task**.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-43853d.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-52%20passing-brightgreen.svg)](#tests)

---

## What it shows

**In the statusline (every assistant turn):**

```
Opus  5h ▰▰ 24% (2h 14m)  7d ▰▰▰▰ 41% (2d 4h)  ctx ▰▱▱▱▱ 12% (16k/200k)  ↑16k ↓1.2k cache ▰▰▰▱▱ 65%  Σ↑6.8M ↓94k cache ▰▰▰▰▰ 96%  API≈$0.12  +156/-23
```

Every bounded metric (rate-limit windows, context fill, cache hit %) gets
a colored progress bar; tokens, cost, and lines stay numeric. Cache-hit
colors are inverted relative to rate-limit colors (higher = greener) since
a high hit rate means cheap, fast turns.

When the statusline is too long for the terminal it **wraps to two lines**
— *limits* (model / 5h / 7d / ctx) on top, *activity* (tokens / cost /
lines) below. Override behaviour:

```
CC_USAGE_MONITOR_WIDTH=120     # wrap when visible width exceeds N columns
CC_USAGE_MONITOR_TWO_LINE=1    # always two lines
CC_USAGE_MONITOR_NO_SESSION=1  # skip transcript walk (no Σ segment)
```

**In the CLI after every task (Stop hook):**

```
┌─ cc-usage-monitor ─────────────────────────────────────────────────────┐
│ 5h window  ▰▰▰▱▱▱▱▱▱▱▱▱   24%   resets in 2h 14m                       │
│ 7d window  ▰▰▰▰▰▱▱▱▱▱▱▱   41%   resets in 2d 4h                        │
│ Context    ▰▱▱▱▱▱▱▱▱▱▱▱   12%   16k of 200k                            │
│ This turn  ↑ 16k  •  ↓ 1.2k  •  ▰▰▰▰▰▰▰▰▱▱▱▱  65% cached               │
│ Session    ↑ 6.8M  •  ↓ 94k  •  ▰▰▰▰▰▰▰▰▰▰▰▱  96% cached  •  65 turns  │
│ Cost       API≈$0.123  •  +156/-23 lines  •  Opus                      │
└────────────────────────────────────────────────────────────────────────┘
```

The six rows in the box:

- **5h / 7d window** — rate-limit usage with a colored bar and reset
  countdown.
- **Context** — how much of the model's context window is currently
  loaded, with absolute used/total token counts. Color thresholds the
  same as the rate-limit rows.
- **This turn** — tokens for the most recent assistant turn plus the
  prompt-cache hit rate for that turn.
- **Session** — cumulative tokens across the whole session, computed by
  walking the transcript JSONL log on disk and deduping by Anthropic
  message ID. Includes a session-wide cache-hit rate (more stable than
  the per-turn one) and a turn count.
- **Cost** — `API≈$X.XX` makes it explicit that the figure is what the
  session would have cost on the pay-as-you-go API (helpful for Pro/Max
  subscribers to see the value of the flat-rate plan), plus lines added
  and removed and the active model.

Plus a `/cc-usage-monitor:usage` slash command for an on-demand detailed
report (uses [`ccusage`](https://github.com/ryoppippi/ccusage) under the hood).

## Why

Anthropic enforces two rolling rate-limit windows for Claude Pro / Max plans
that share quota across Claude.ai and Claude Code:

| Window | What it measures | When it resets |
| ------ | ---------------- | -------------- |
| **5-hour** | Burst usage in the active session | 5 hours from your first prompt |
| **7-day**  | Weekly usage  | Continuous; oldest day rolls off |

If you've ever been surprised by "you've hit your weekly limit" in the middle
of a deep work session, this plugin is for you.

## Features

- **5-hour and 7-day rate-limit usage** with colored bars and reset countdowns.
- **API-equivalent price** (`API≈$X.XX`) so you know what the session would
  have cost on the pay-as-you-go API.
- **Token counts** for the latest turn (statusline) and **session-cumulative
  totals** (Stop-hook box) computed from the transcript JSONL log, deduped
  by Anthropic message ID.
- **Cache-hit percentage** at both turn and session granularity.
- **Lines added / removed** from the active session.
- **Zero dependencies** — pure Node.js stdlib, no `node_modules` to install.
- **Cross-platform** — Windows, macOS, Linux. The same script runs everywhere.
- **Color-coded thresholds** — green < 70 %, yellow 70-90 %, red ≥ 90 %.
- **Graceful degradation** — anonymous API users (no `rate_limits` field) get
  cost + model only; nothing crashes.
- **Quietable** — set `CC_USAGE_MONITOR_QUIET=1` to silence the post-task box.
- **One-step updates** — `/cc-usage-monitor:update` pulls the latest from GitHub.
- **No telemetry, no network** — reads only the JSON Claude Code already pipes
  to your statusline (and the optional `npx ccusage` invocation in the slash
  command, when you trigger it).

## Install

### Option 1 — manual install (recommended)

Clone the repo into a stable directory and add two lines to your Claude Code
settings. Works on every platform, easiest to update.

```bash
git clone https://github.com/harveyxiacn/cc-usage-monitor.git ~/.claude/plugins/cc-usage-monitor
```

Then edit `~/.claude/settings.json` and merge in:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/cc-usage-monitor/bin/statusline.js",
    "padding": 1
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/plugins/cc-usage-monitor/bin/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

On Windows replace `~/` with the absolute path (e.g. `C:/Users/YourName/.claude/...`)
because PowerShell and cmd don't expand `~` when Claude Code spawns the
command. Forward slashes work fine on Windows in JSON values.

Restart Claude Code or run `/reload-plugins` to pick up the change.

### Option 2 — quick try-out (no install)

```bash
git clone https://github.com/harveyxiacn/cc-usage-monitor.git
claude --plugin-dir ./cc-usage-monitor
```

This loads the plugin for the current Claude Code session only — handy for
poking at it before committing to a real install.

### Option 3 — marketplace install (experimental)

```bash
claude plugin marketplace add harveyxiacn/cc-usage-monitor
claude plugin install cc-usage-monitor@cc-usage-monitor-marketplace
```

The plugin ships a `.claude-plugin/marketplace.json`, but I haven't tested
this path end-to-end. If it doesn't work for you, fall back to Option 1.

## Updating

### One-step update (recommended)

Inside any Claude Code session, run:

```
/cc-usage-monitor:update
```

This pulls the latest version from GitHub, prints `vOLD → vNEW`, and shows
the relevant section of the changelog. The new version is live on the next
assistant turn — no restart required for direct `settings.json` installs.

### Manual update

If you'd rather run git yourself:

```bash
git -C ~/.claude/plugins/cc-usage-monitor pull
```

(Replace the path with wherever you cloned it.)

### Following releases

Watch the repo or subscribe to releases on GitHub:

- Releases: https://github.com/harveyxiacn/cc-usage-monitor/releases
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Configuration

| Environment variable | Effect |
| --- | --- |
| `CC_USAGE_MONITOR_QUIET=1`        | Silences the post-task box. Statusline still updates. |
| `CC_USAGE_MONITOR_NO_SESSION=1`   | Skip the transcript walk in the statusline (drops the `Σ` segment). The Stop-hook Session row is unaffected. |
| `CC_USAGE_MONITOR_WIDTH=N`        | Wrap statusline to two lines when its visible width exceeds N columns. Defaults to `process.stdout.columns` / `$COLUMNS` / `160`. |
| `CC_USAGE_MONITOR_TWO_LINE=1`     | Force two-line statusline regardless of width. |
| `NO_COLOR=1`                      | Disables ANSI colors (statusline + Stop hook). |
| `CC_USAGE_MONITOR_NO_COLOR=1`     | Same as `NO_COLOR=1`. |
| `FORCE_COLOR=0`                   | Force colors off. |

## How it works

Claude Code passes a JSON document over stdin to your statusline command on
every assistant turn. For Pro/Max accounts that JSON contains a `rate_limits`
object with `five_hour` and `seven_day` fields holding `used_percentage` and
`resets_at` (Unix epoch seconds). The plugin reads that, formats a compact
line, and prints it.

The Stop hook receives the same shape on stdin when an assistant turn
finishes. We render a slightly bigger box and write it to **stderr** so the
message appears inline in the CLI without polluting the assistant transcript.

The slash command shells out to `ccusage` for a richer report when you want
one on demand.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full architecture.

## Tests

```bash
npm test
```

Runs **40 tests** covering:

- formatter unit tests (bar rendering, time-until, cost formatting, token
  abbreviation, cache-hit math, color thresholds)
- transcript walker unit tests (dedup-by-message-id, missing path, empty
  file, non-assistant entries)
- statusline integration tests against five fixture JSON payloads (full,
  high-usage, no-rate-limits, missing-cost, no-cache)
- Stop-hook integration tests (output goes to stderr, layout sections,
  Session line appears only when `transcript_path` is provided,
  `CC_USAGE_MONITOR_QUIET` silences output)

All tests use Node's built-in `node:test` runner — no jest, no mocha, no
external deps.

## Compatibility

- Claude Code with the plugin / hooks system
- Pro / Max subscribers see all fields; anonymous API users see cost + model
  (the `rate_limits` field is only populated for subscribers)
- Node.js ≥ 18 (uses only stable stdlib APIs)

## FAQ

**Q: My statusline shows the model name but no `5h` / `7d` numbers.**
A: The `rate_limits` field is only present on Pro/Max subscriptions and only
after Claude Code receives at least one API response in the session. Send a
prompt and they should appear.

**Q: The box shows up after every task — can I quiet it?**
A: `export CC_USAGE_MONITOR_QUIET=1` and restart Claude Code.

**Q: Why does the 5-hour reset time say "now"?**
A: Either your session has been idle past 5 hours (in which case sending a new
prompt starts a new window), or your clock is skewed.

**Q: Will this work on Windows?**
A: Yes. The scripts use only `process.stdin` and Node stdlib — no shell
pipes. Tested on Windows 11 / PowerShell.

## Contributing

PRs welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- The Anthropic Claude Code team for the [statusline contract](https://code.claude.com/docs/en/statusline) and [plugin system](https://code.claude.com/docs/en/plugins).
- [`ccusage`](https://github.com/ryoppippi/ccusage) — the de facto offline
  Claude Code usage analyser, used by the slash command.
