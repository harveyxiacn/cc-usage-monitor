---
description: Customize which cc-usage-monitor components are shown, pick a style and bar style, and persist the choice
allowed-tools: Bash(node*)
---

# /config

Interactively configure the cc-usage-monitor statusline and Stop-hook box.
Choices are saved to a config file (default `~/.claude/cc-usage-monitor.json`)
and take effect on the next assistant turn — no restart needed. Environment
variables (`CC_USAGE_MONITOR_*`) always override the file.

## Step 1 — Read the current state

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" get
```

This prints the saved config, the config file path, the valid component keys
with one-line descriptions, the valid bar styles, and the ten style presets
(`validStyles` / `styleHelp` / `currentStyle`).

## Step 2 — Style (optional)

`style` picks a whole look — glyphs, bar widths, labels, separators and
colors — for both the statusline and the Stop-hook box. There are ten:
`classic`, `minimal`, `compact`, `detailed`, `bracket`, `ascii`, `dots`,
`badge`, `emoji`, `mono`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" preview      # renders all ten
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" set style dots
```

For a guided pick with the previews rendered side by side, send the user to
`/cc-usage-monitor:style` instead of doing it here.

## Step 3 — Decide what to change

**If the user already said what they want** (in the command arguments or the
conversation), skip the questions and apply it directly.

**If the user asked you to choose for them** ("you pick", "让AI选择", etc.),
pick a sensible layout for them and explain your reasoning in one sentence.
Guidelines: keep `model`, `ctx`, `5h`, `7d`, `cost` for almost everyone; add
`turn` + `session` for token watchers; drop `session` on slow disks or huge
transcripts; prefer `ascii` bars only when their terminal mangles Unicode.

**Otherwise, ask.** Use the AskUserQuestion tool with two questions:

1. **Components** (multiSelect: true) — one option per component key from
   Step 1's `validComponents`, using `componentHelp` as descriptions. Mark
   the current/default set as selected guidance in the descriptions
   (`defaultShow` from Step 1, or `config.show` when set). Note: `session`
   already embeds the lines added/removed counter, so don't combine
   `session` and `lines` — that renders +N/-M twice. Offer `lines` as
   "lines without session tokens".
2. **Bar style** (single select) — `block ▰▰▱▱▱`, `shade ██░░░`,
   `square ■■□□□`, `thin ━━╌╌╌`, `ascii ##---`. Skip this question if the
   user only asked about components.

## Step 4 — Apply

Component order matters (it's the display order). Preserve the canonical
order `model, ctx, 5h, 7d, turn, session, cost, lines` unless the user asked
for a custom order. Then run, e.g.:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" set show model,ctx,5h,7d,cost
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" set barStyle shade
```

Other available keys: `style <preset>` (Step 2), `twoLine true|false`,
`width <columns>`, `quiet true|false` (silences the post-task box),
`noSession true|false` (skips the transcript walk), and the seven style
overrides that fine-tune the chosen preset — `sep »` (1-3 chars),
`barWidth 8` (1-20), `boxBarWidth 16` (1-40), `brackets []` (2 chars or
`none`), `showReset true|false`, `showCtxDetail true|false`, `labels
ctx=context,5h=5-hour` (merges; empty value hides a label) — described in
Step 1's `overrideHelp`, with the combined result in `effective`.
`reset [key]` clears a setting (or all of them).

## Step 5 — Confirm

Tell the user what was saved and where, and that it takes effect on the next
assistant turn. If they have a `CC_USAGE_MONITOR_SHOW` or
`CC_USAGE_MONITOR_BAR_STYLE` environment variable set (visible because the
saved config doesn't change the line), point out that env vars override the
config file and would need to be unset.
