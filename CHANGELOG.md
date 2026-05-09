# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
