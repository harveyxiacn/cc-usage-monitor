# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-05-09

### Added

- **Progress bars on every bounded metric:**
  - Statusline: 5-cell inline bar before the context-window % (`ctx ▰▱▱▱▱ 12%`) and after each token group (`↑16k ↓1.2k cache ▰▰▰▱▱ 65%` and `Σ↑6.8M ↓94k cache ▰▰▰▰▱ 96%`).
  - Stop-hook box: 12-cell bar in the cache-hit segment of both `This turn` and `Session` rows.
- **Inverted color thresholds for cache hit** — higher = better, since high cache reuse means cheaper, faster turns. New `colorForCacheHit` helper: `≥ 70 %` green, `40-70 %` yellow, `< 40 %` red.
- **Multi-line wrapping when the statusline is too long** to fit on one line. Splits between the *limits* group (model / 5h / 7d / ctx) and the *activity* group (turn / session / cost / lines).
  - Width is detected from `process.stdout.columns`, then `$COLUMNS`, then defaults to 160.
  - Override via `CC_USAGE_MONITOR_WIDTH=N`.
  - Force two-line layout regardless of width with `CC_USAGE_MONITOR_TWO_LINE=1`.

### Tests

- 7 new tests (52 total): inverted cache-hit color thresholds, ctx bar pattern, turn cache bar pattern, session cache bar pattern (Stop hook), narrow width wraps, wide width keeps single line, `CC_USAGE_MONITOR_TWO_LINE=1` forces wrap.



### Added

- **One-step update** via the new `/cc-usage-monitor:update` slash command. Runs `git pull --ff-only` in the plugin directory, prints `vOLD → vNEW`, and shows the relevant changelog section. The new version is live on the next assistant turn for direct `settings.json` installs.
- New `bin/update.js` self-updater (works standalone too: `node bin/update.js`). Detects non-git installs and prints recovery instructions.
- README **Updating** section documenting the slash command, manual git pull, and how to follow releases.
- Install section restructured: manual install promoted to Option 1 (recommended), with a Windows note about `~/` not expanding.



### Added

- **Context-window utilisation** in both surfaces:
  - Statusline: `ctx 12% (16k/200k)` — colored percentage plus absolute used/total in tokens.
  - Stop-hook box: new `Context` row with a 12-cell bar, percentage, and absolute size.
- **Session-cumulative tokens in the statusline** — the same transcript walker the Stop hook uses now feeds the statusline too. Rendered as `Σ↑6.8M ↓94k` (Σ marks the cumulative segment to distinguish it from the per-turn `↑16k ↓1.2k`).
- New `CC_USAGE_MONITOR_NO_SESSION=1` env var as an escape hatch to skip the transcript walk in the statusline (turn-level numbers still show).

### Changed

- Statusline: `ctx X%` is now always shown when context-window data is present, instead of only at ≥ 50%. Lets you watch context fill up from the very first turn.
- `lib/parse.js` now exposes `contextSize` and falls back to computing `contextPct` from `total_input_tokens / context_window_size` when Claude Code's payload omits `used_percentage`.

### Tests

- 5 new tests (45 total): statusline ctx segment + absolute size, statusline Σ session segment, `CC_USAGE_MONITOR_NO_SESSION` escape hatch, no-rate-limits omits ctx, on-stop Context row.

## [0.3.1] - 2026-05-08

### Fixed

- Statusline and Stop-hook output appeared without colors when run by Claude Code. Root cause: color detection was gated on `process.stdout.isTTY`, but Claude Code spawns these scripts with stdio piped (so `isTTY` is always false), even though the terminal that ultimately renders the output does interpret ANSI codes. Default behaviour is now color-on; opt out via `NO_COLOR=1`, `CC_USAGE_MONITOR_NO_COLOR=1`, or `FORCE_COLOR=0`.

## [0.3.0] - 2026-05-08

### Added

- **Session-cumulative token totals** in the Stop-hook box. The hook now reads `transcript_path` from the incoming JSON, walks the JSONL log on disk, and sums tokens (input, output, cache reads, cache creation) across the whole session — deduped by Anthropic message ID so triple-logged content blocks count once.
- **Session cache-hit rate** alongside the totals — a more stable indicator of prompt-caching efficiency than the latest-turn rate.
- **Turn count** on the Session line.
- New `lib/transcript.js` module: streaming JSONL walker with watchdog timeout, 50 MB safety cap, and graceful no-op when the path is missing.

### Changed

- **Stop-hook box layout** restructured into clearer sections: rate-limit windows, then `This turn` (turn-level tokens), then `Session` (cumulative from transcript), then `Cost` (price + lines + model).
- Box inner width widened to 60 columns to fit the new Session line on long sessions.
- `Tokens` row renamed to `This turn`; `Session` was the prior cost line and is now its own dedicated cumulative-totals line. The cost/lines/model row is now `Cost`.

### Tests

- 4 new `lib/transcript.js` unit tests (dedup-by-message-id, missing path, empty file, non-assistant entries).
- Updated Stop-hook integration tests for the new layout, plus a new test verifying the Session line appears only when `transcript_path` is set and skipped otherwise.
- 40 tests total, all passing.

## [0.2.0] - 2026-05-08

### Added

- **Token usage** in both the statusline and the Stop-hook box: input / output token counts (with `k` and `M` abbreviations) plus the latest-turn cache-hit percentage when prompt caching saved tokens.
- **`API≈$X.XX` label** for the cost field, making it explicit that the displayed amount is the API-equivalent cost (what the session would have cost on the pay-as-you-go API) rather than your flat Pro/Max subscription price.
- New `formatTokens` helper in `lib/format.js` and `cacheHitPercent` helper in `lib/parse.js`.
- New fixture `test/fixtures/no-cache.json` covering the "tokens but zero cache" scenario.
- 9 additional tests (34 total).

## [0.1.0] - 2026-05-08

### Added

- Statusline script (`bin/statusline.js`) showing 5-hour and 7-day rate-limit usage with colored bars, model name, session cost, and lines added/removed.
- Stop hook (`bin/on-stop.js`) that prints a boxed usage summary after every task, visible in the Claude Code CLI.
- `/cc-usage-monitor:usage` slash command for an on-demand detailed report (uses `ccusage` for 5-hour blocks plus a local 7-day walker).
- Cross-platform support (Node.js, no native deps); works on Windows, macOS, Linux.
- Plugin manifest (`.claude-plugin/plugin.json`) and marketplace manifest (`.claude-plugin/marketplace.json`) for distribution.
- MIT-licensed; full test suite using Node's built-in `node:test` runner with fixture-based tests.
