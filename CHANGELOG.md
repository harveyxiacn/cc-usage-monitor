# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-08

### Added

- Statusline script (`bin/statusline.js`) showing 5-hour and 7-day rate-limit usage with colored bars, model name, session cost, and lines added/removed.
- Stop hook (`bin/on-stop.js`) that prints a boxed usage summary after every task, visible in the Claude Code CLI.
- `/cc-usage-monitor:usage` slash command for an on-demand detailed report (uses `ccusage` for 5-hour blocks plus a local 7-day walker).
- Cross-platform support (Node.js, no native deps); works on Windows, macOS, Linux.
- Plugin manifest (`.claude-plugin/plugin.json`) and marketplace manifest (`.claude-plugin/marketplace.json`) for distribution.
- MIT-licensed; full test suite using Node's built-in `node:test` runner with fixture-based tests.
