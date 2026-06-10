# cc-usage-monitor

> A Claude Code plugin that puts your **5-hour** and **7-day** rate-limit usage
> in the statusline — and shows a compact summary in the CLI **after every
> task**.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-43853d.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-90%20passing-brightgreen.svg)](#tests)

---

## What it shows

**In the statusline (every assistant turn):**

```
Fable 5 │ ctx ▰▰▱▱▱ 32% (320k/1.0M) │ 5h ▰▱▱▱▱ 18% (2h 13m) │ 7d ▰▰▱▱▱ 36% (2d 3h) │ Σ↑5.5k ↓3.2k │ +12/-3 │ cache ▰▰▱▱▱ 38% │ API≈~$0.101
```

(When the line is wider than the terminal it wraps into two lines, splitting
between the limits group and the activity group.)

Every bounded metric (rate-limit windows, context fill, cache hit %) gets
a colored progress bar; tokens, cost, and lines stay numeric. Cache-hit
colors are inverted relative to rate-limit colors (higher = greener) since
a high hit rate means cheap, fast turns.

Which components appear — and in what order — is fully configurable via
`CC_USAGE_MONITOR_SHOW`. The bar style is configurable via
`CC_USAGE_MONITOR_BAR_STYLE`. See [Configuration](#configuration) below.

**In the CLI after every task (Stop hook):**

```
┌─ cc-usage-monitor ────────────────────────────────────────────────────┐
│ 5h window  ▰▰▱▱▱▱▱▱▱▱▱▱   18%   resets in 2h 13m                      │
│ 7d window  ▰▰▰▰▱▱▱▱▱▱▱▱   36%   resets in 2d 3h                       │
│ Context    ▰▰▰▰▱▱▱▱▱▱▱▱   32%   320k of 1.0M                          │
│ This turn  ↑ 320k  •  ↓ 2.4k  •  ▰▰▰▰▰▰▰▰▰▰▰▰  97% cached             │
│ Session    ↑ 5.5k  •  ↓ 3.2k  •  ▰▰▰▰▰▱▱▱▱▱▱▱  38% cached  •  4 turns │
│ Models     Fable 5 $0.090  •  Haiku 4.5 $0.011                        │
│ Cost       API≈$0.101 (est.)  •  +12/-3 lines  •  Fable 5             │
└───────────────────────────────────────────────────────────────────────┘
```

The rows in the box:

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
- **Models** — per-model API-equivalent cost breakdown, shown when the
  session mixed models (e.g. main loop on Fable 5, subagents on Haiku).
  Computed from the transcript token totals and the bundled pricing table.
- **Cost** — `API≈$X.XX` makes it explicit that the figure is what the
  session would have cost on the pay-as-you-go API (helpful for Pro/Max
  subscribers to see the value of the flat-rate plan), plus lines added
  and removed and the active model. When Claude Code doesn't report a
  cost, the plugin computes one from the transcript and the bundled
  pricing table and marks it as an estimate — `API≈~$X` in the statusline,
  `API≈$X (est.)` in the box.

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
  have cost on the pay-as-you-go API. When Claude Code doesn't report a cost,
  it's computed from the transcript using a bundled pricing table covering
  every current model — Fable 5 / Mythos 5 ($10/$50 per MTok), Opus 4.8–4.5
  ($5/$25), Sonnet 4.x ($3/$15), Haiku 4.5 ($1/$5), fast-mode Opus premiums,
  and the official cache multipliers (0.1× reads, 1.25× 5-minute writes,
  2× 1-hour writes).
- **Per-model cost breakdown** in the Stop-hook box for mixed-model sessions
  (main loop + subagents on different models).
- **Friendly model names** even when Claude Code sends only a raw ID —
  `claude-fable-5[1m]` renders as `Fable 5`.
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
- **Configurable layout** — choose which components appear and in what order,
  interactively via `/cc-usage-monitor:config` (checklist or "let the agent
  pick"), persistently via the config file, or per-shell via
  `CC_USAGE_MONITOR_SHOW`.
- **5 bar styles** — `block` (default), `shade`, `square`, `thin`, `ascii` via `CC_USAGE_MONITOR_BAR_STYLE`.
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

### Interactive setup (recommended)

Run the config command inside any Claude Code session:

```
/cc-usage-monitor:config
```

The agent shows a checklist of components and bar styles, saves your picks
to `~/.claude/cc-usage-monitor.json`, and they take effect on the next
assistant turn. You can also just tell it what you want ("only model, ctx
and cost", "use ascii bars", or even "you pick a sensible layout for me")
and it applies the change directly. Environment variables always override
the config file, so existing setups are unaffected.

The same settings can be managed from a terminal:

```bash
node ~/.claude/plugins/cc-usage-monitor/bin/config.js get
node ~/.claude/plugins/cc-usage-monitor/bin/config.js set show model,ctx,5h,7d,cost
node ~/.claude/plugins/cc-usage-monitor/bin/config.js set barStyle shade
node ~/.claude/plugins/cc-usage-monitor/bin/config.js reset        # clear everything
```

### Choosing which components to display

Set `CC_USAGE_MONITOR_SHOW` to a comma-separated list of component keys
(or use `/cc-usage-monitor:config` above — the env var wins on conflict).
The order you write them is the order they appear in the statusline.

```
CC_USAGE_MONITOR_SHOW=model,ctx,5h,7d,session,cost
```

| Key | What it shows | Default |
| --- | --- | :---: |
| `model` | Model name (e.g. `Fable 5`) | ✓ |
| `ctx` | Context window usage bar + % + `(used/total)` | ✓ |
| `5h` | 5-hour rate-limit bar + % + reset countdown | ✓ |
| `7d` | 7-day rate-limit bar + % + reset countdown | ✓ |
| `turn` | Current-turn input/output tokens + cache-hit bar | |
| `session` | Session-cumulative tokens · lines added/removed · cache-hit bar | ✓ |
| `cost` | API-equivalent cost (`API≈$X.XX`), computed from the transcript when Claude Code doesn't report one | ✓ |
| `lines` | Lines added/removed only (standalone, without session tokens) | |

If `CC_USAGE_MONITOR_SHOW` is not set, the default order is:
`model, ctx, 5h, 7d, session, cost`.

> **Note:** `lines` is embedded inside the `session` component by default
> (`Σ↑3.1M ↓22k │ +153/-125 │ cache ▰▰▰▰▰ 96%`). Use the standalone `lines`
> key only when you want lines without session token counts.

### Choosing a bar style

Set `CC_USAGE_MONITOR_BAR_STYLE` to one of the values below.

```
CC_USAGE_MONITOR_BAR_STYLE=shade
```

| Value | Example (40% filled, 5 cells) | Character set |
| --- | --- | --- |
| `block` *(default)* | `▰▰▱▱▱` | `▰` filled · `▱` empty |
| `shade` | `██░░░` | `█` filled · `░` empty |
| `square` | `■■□□□` | `■` filled · `□` empty |
| `thin` | `━━╌╌╌` | `━` filled · `╌` empty |
| `ascii` | `##---` | `#` filled · `-` empty (no Unicode required) |

### Setting environment variables

**macOS / Linux** — add to your shell profile or prefix the command:

```bash
export CC_USAGE_MONITOR_SHOW=model,ctx,5h,7d,cost
export CC_USAGE_MONITOR_BAR_STYLE=shade
```

**Windows** — set system-wide with `setx` (takes effect after restart):

```powershell
setx CC_USAGE_MONITOR_SHOW "model,ctx,5h,7d,cost"
setx CC_USAGE_MONITOR_BAR_STYLE "shade"
```

Or inline in `settings.json` if you want to scope it to Claude Code only:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'CC_USAGE_MONITOR_SHOW=model,ctx,5h,7d,cost CC_USAGE_MONITOR_BAR_STYLE=shade exec node ~/.claude/plugins/cc-usage-monitor/bin/statusline.js'",
    "padding": 1
  }
}
```

### Other toggles

| Environment variable | Effect |
| --- | --- |
| `CC_USAGE_MONITOR_QUIET=1`      | Silences the post-task box. Statusline still updates. |
| `CC_USAGE_MONITOR_NO_SESSION=1` | Skip the transcript walk in the statusline (drops the `Σ` segment). The Stop-hook Session row is unaffected. |
| `CC_USAGE_MONITOR_TWO_LINE=1`   | Force the statusline to wrap to two lines. |
| `CC_USAGE_MONITOR_WIDTH=N`      | Wrap to two lines when the visible width exceeds N columns. |
| `CC_USAGE_MONITOR_CONFIG=path`  | Use a different config file location. |
| `NO_COLOR=1`                    | Disables ANSI colors (statusline + Stop hook). |
| `CC_USAGE_MONITOR_NO_COLOR=1`   | Same as `NO_COLOR=1`. |
| `FORCE_COLOR=0`                 | Force colors off. |

All of these except the color toggles and the config path can also be set
persistently via `/cc-usage-monitor:config` (config-file keys: `show`,
`barStyle`, `twoLine`, `width`, `quiet`, `noSession`). Precedence:
environment variable → config file → built-in default.

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

Runs **90 tests** covering:

- formatter unit tests (bar rendering, time-until, cost formatting, token
  abbreviation, cache-hit math, color thresholds)
- pricing unit tests (model-ID resolution incl. `[1m]` / date / provider
  suffixes, Fable 5 and fast-mode rates, 5m vs 1h cache-write math,
  mixed-model session totals, unknown-model guards)
- transcript walker unit tests (dedup-by-message-id, per-model bucketing,
  missing path, empty file, non-assistant entries)
- statusline integration tests against six fixture JSON payloads (full,
  high-usage, no-rate-limits, missing-cost, no-cache, fable)
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
