# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-09-02

### Added

- **10 selectable styles** for the statusline *and* the Stop-hook box, driven by one setting: `classic` (default, unchanged), `minimal`, `compact`, `detailed`, `bracket`, `ascii`, `dots`, `badge`, `emoji`, `mono`. A style bundles bar glyphs and widths, separators, labels, countdown / context-detail visibility, box borders and the color mode (`badge` paints each segment on a colored background; `mono` uses no color at all and bolds values past the red threshold; `ascii` is pure 7-bit on both surfaces). Switch with `CC_USAGE_MONITOR_STYLE=<name>` (env), `style` in the config file, or the new **`/cc-usage-monitor:style`** command, which renders all ten side by side (`node bin/config.js preview`) before asking. `barStyle` still composes on top of any style that has bars. Unknown names render as `classic` at runtime and are rejected by `set style`.
- New `lib/theme.js` preset registry (pure data, no I/O on the hot path); `bin/config.js` gains `set style`, `preview [style]`, and `validStyles` / `styleHelp` / `currentStyle` in `get`. `/cc-usage-monitor:config` documents the new key.
- `lib/format.js`: `paint()` accepts background colors and style arrays, `bar()` takes an explicit glyph set, and `makePainter(theme)` centralises the default / mono / badge color modes.
- New `test/manifest.test.js`: the three manifests must agree on the version, the CHANGELOG must have a section for it, and every slash command needs front-matter.

### Changed

- **Pricing table refreshed for the 2026-09 model roster**, verified against the live platform.claude.com pricing page on 2026-09-02:
  - **Fable 5.1 / Mythos 5.1** — `claude-fable-5-1` (incl. `[1m]`) renders as `Fable 5.1` and prices at $10/$50 per MTok with the new **flat $0.25/MTok cache-read rate** (0.025×, a quarter of Fable 5's $1). Cache writes keep the standard 1.25× / 2× multipliers ($12.50 / $20).
  - **Opus 5** — $5/$25, same as Opus 4.8–4.5; **Opus 5 Fast** $10/$50.
  - **Sonnet 5** — $2/$10 (the launch price is now the standard price; the planned $3/$15 increase was cancelled).
  - Fast-mode premium rows for Opus 4.7 / 4.6 were removed: Opus 4.7 rejects `speed: "fast"` and Opus 4.6 bills it at standard rates, so those IDs now fall through to the plain $5/$25 rows.
- **Version-boundary model matching** in `lib/pricing.js` replaces plain substring matching. A registry key only matches when it isn't followed by a further point-version, so `claude-fable-5-1` can never be mistaken for `fable-5`, and unlisted point releases (`claude-fable-5-2`, `claude-opus-5-1`, `claude-sonnet-4-7`, …) are reported as *unknown* instead of inheriting a predecessor's rates — Fable 5.1 changing only the cache-read price is exactly the case a "same family, same price" guess gets wrong. Date suffixes, Vertex `@date` and Bedrock `-v1:0` suffixes, and `-fast` still match.
- The `sonnet-4` and `opus-4` rows now rely on that boundary rule: they match the bare, dated (`-20250514`) and Vertex (`@20250514`) forms of Sonnet 4 / Opus 4 — Vertex Opus 4 was previously unpriced — without swallowing unlisted 4.x point releases.

### Fixed

- The Stop-hook **Models** breakdown no longer lists the same model twice when a session logs it under two raw IDs (e.g. `claude-fable-5-1` and `claude-fable-5-1[1m]` after a context-mode switch) — `sessionCost` now merges rows by registry entry.

### Tests

- Pricing: Fable 5.1 / Opus 5 / Sonnet 5 rates, the flat Fable 5.1 cache-read price, version-boundary matching (`keyMatches`), pinned Sonnet 4, Bedrock / Vertex ID shapes, fast-mode fall-through, and breakdown merging.
- New `test/models.test.js` end-to-end suite: `claude-fable-5-1[1m]` → `Fable 5.1` on both surfaces, a Fable 5.1 + Sonnet 5 transcript priced at the new rates (statusline `API≈~$0.111`, box `Models Fable 5.1 $0.088 • Sonnet 5 $0.022`), and `display_name` precedence.
- Styles: every preset resolves with the full shape, env-over-config precedence, `barStyle` override rules, `classic` byte-identical to 0.7.x (verified over 288 fixture × env combinations), `ascii` pure-ASCII on both surfaces, `mono` free of color codes yet bold on high usage, `badge` background codes with a `NO_COLOR` fallback, rectangular boxes for every preset, and the `preview` / `set style` CLI paths. 165 tests total.

## [0.7.0] - 2026-06-10

### Added

- **Fable 5 (and full current-model) support** via the new `lib/pricing.js` model registry:
  - **Display-name fallback** — when Claude Code sends only a raw model ID (e.g. `claude-fable-5[1m]`), both surfaces now render the friendly name (`Fable 5`) instead of the raw ID. Bracket suffixes like `[1m]`, date suffixes, and Bedrock-style `anthropic.` prefixes are all handled. Claude Code's own `display_name` still wins when present.
  - **Pricing table** verified against the live platform.claude.com pricing page (2026-06): Fable 5 / Mythos 5 ($10/$50 per MTok), Opus 4.8–4.5 ($5/$25), Opus 4.1/4 ($15/$75), Sonnet 4.x ($3/$15), Haiku 4.5 ($1/$5), plus legacy Haiku/Sonnet/Opus 3 models and fast-mode Opus premiums (Opus 4.8 Fast $10/$50, Opus 4.7/4.6 Fast $30/$150). Cache multipliers follow the official rules: reads 0.1×, 5-minute writes 1.25×, 1-hour writes 2× — and stack on fast-mode pricing. The 1M context window on Fable 5 / Opus 4.8–4.6 / Sonnet 4.6 has no long-context premium, so none is modelled.
  - **Computed API-equivalent cost** — when Claude Code omits `cost.total_cost_usd`, both surfaces now compute the session cost from per-model transcript token totals, marked as an estimate (`API≈~$X` in the statusline, `API≈$X (est.)` in the box). A computed figure is only shown when every model in the session is priced and the transcript walk completed in full (no silent undercounting). Unknown future model IDs deliberately price as *unknown* rather than guessing — e.g. a hypothetical `claude-opus-4-9` is not priced at the old Opus 4 rate.
  - **Per-model cost breakdown** in the Stop-hook box (`Models  Fable 5 $0.090  •  Haiku 4.5 $0.011`) for mixed-model sessions — e.g. main loop on Fable 5 with subagents on Haiku. Sorted by cost, shown only when the session used ≥ 2 models.
- `lib/transcript.js` now buckets token totals **per model** (`models` field) and tracks the 1-hour cache-write subset (`usage.cache_creation.ephemeral_1h_input_tokens`) so the 2× TTL rate is billed correctly.
- **Interactive display configuration** via the new `/cc-usage-monitor:config` slash command: the agent presents a checklist of statusline components and bar styles (or picks a sensible layout when asked to), and persists the choice to `~/.claude/cc-usage-monitor.json` via the new `bin/config.js` CLI (`get` / `set` / `reset`). Settings take effect on the next assistant turn.
- New `lib/config.js`: validated config file covering `show`, `barStyle`, `twoLine`, `width`, `quiet`, and `noSession`. The file fills in any `CC_USAGE_MONITOR_*` env var that isn't already set — env vars keep priority, so existing setups are unaffected. Override the file location with `CC_USAGE_MONITOR_CONFIG`.

### Changed

- The Stop-hook box now **auto-widens** to its longest row, so long Session / Models / Cost lines widen the frame instead of breaking the right border.

### Fixed

- A custom `CC_USAGE_MONITOR_SHOW` order is rendered exactly as written when everything fits on one line; the limits/activity grouping now applies only when wrapping.
- `CC_USAGE_MONITOR_TWO_LINE=0` (or `=false`) no longer force-*enables* the two-line layout.
- The statusline / Stop-hook process no longer lingers when Claude Code opens stdin but never closes it (stdin is destroyed after the 1500 ms watchdog fires).
- Test harness now strips `CC_USAGE_MONITOR_*` variables from the developer's shell, so local customisations can't change test results.

### Tests

- Pricing unit tests (registry lookup incl. legacy/date-suffixed/future IDs, Fable 5 / fast-mode / 1h-cache math, incomplete-session guards), per-model transcript bucketing and TTL-breakdown derivation, integration tests for the Fable 5 fixture on both surfaces (display-name fallback, computed cost with `~`/`(est.)` markers, reported-cost precedence, Models breakdown), `CC_USAGE_MONITOR_SHOW` order preservation, `TWO_LINE=0`, and config tests (validation, env-over-file precedence, CLI get/set/reset, quiet-via-config).

## [0.6.1] - 2026-06-04

### Fixed

- **Marketplace install** — `marketplace.json` plugin source `"."` → `"./"`; the
  current Claude Code marketplace schema rejects `"."`, which blocked
  `claude plugin install` (README Option 3).
- **Two-line wrapping actually works now** — the `CC_USAGE_MONITOR_WIDTH` /
  `CC_USAGE_MONITOR_TWO_LINE` layout documented in 0.6.0 had been left
  unimplemented in `render()`; restored it (limits group on line 1, activity
  group on line 2).
- **Per-turn cache-hit bar** restored in the statusline `turn` component
  (suppressed at 0%), matching the 0.6.0 changelog and the Stop-hook
  "This turn" row.
- **Statusline context size** now shows actual input tokens (`(16k/200k)`)
  instead of `used_percentage × window size`, consistent with the Stop-hook
  box and the README.
- **Stop-hook box** bottom border was 2 columns too wide, misaligning the
  corner; now flush.

### Added

- `.gitattributes` pinning `eol=lf` so line endings stay LF regardless of
  contributor OS (the project was originally developed on Windows).

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

## [0.5.0] - 2026-05-09

### Added

- **One-step update** via the new `/cc-usage-monitor:update` slash command. Runs `git pull --ff-only` in the plugin directory, prints `vOLD → vNEW`, and shows the relevant changelog section. The new version is live on the next assistant turn for direct `settings.json` installs.
- New `bin/update.js` self-updater (works standalone too: `node bin/update.js`). Detects non-git installs and prints recovery instructions.
- README **Updating** section documenting the slash command, manual git pull, and how to follow releases.
- Install section restructured: manual install promoted to Option 1 (recommended), with a Windows note about `~/` not expanding.

## [0.4.0] - 2026-05-09

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
