---
description: Preview the 10 cc-usage-monitor statusline styles and switch between them
allowed-tools: Bash(node*)
---

# /style

Pick the look of the cc-usage-monitor statusline and Stop-hook box. One
setting (`style`) drives both surfaces. The choice is saved to the config
file (default `~/.claude/cc-usage-monitor.json`) and takes effect on the
**next assistant turn** — no restart needed.

## If the user named a style

If `$ARGUMENTS` contains one of `classic minimal compact detailed bracket
ascii dots badge emoji mono`, skip the preview and apply it directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" set style <name>
```

Then confirm in one sentence (what was saved, where, live next turn) and
stop. To see just that one style first, run
`node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" preview <name>`.

## Otherwise — preview, then ask

### Step 1 — Render all ten

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" preview
```

Each line is `<style name> <rendered statusline>`, with a `*` marking the
style that is active right now. The preview runs the real statusline over a
sample payload and inherits the user's own `show` / `barStyle` settings, so
what they see is what they will get.

Show that output **verbatim inside a fenced code block** — the whole point
is that the user compares the glyphs with their own eyes. Do not summarise
it, re-order it, or redraw it in a table.

### Step 2 — Ask

Use AskUserQuestion with a single-select question (max 4 options). Offer
three recommended styles plus the note that picking "Other" lets them type
any of the ten names:

- **classic** — the default: bars, countdowns, threshold colors
- **minimal** — no bars, just labels and colored percentages
- **ascii** — pure 7-bit ASCII for terminals that mangle Unicode

If the user's terminal or earlier messages suggest something else fits
better (a narrow terminal → `compact`, a no-color setup → `mono`), swap that
into the three and say why in one line. Mention in the question description
that the remaining styles — `compact`, `detailed`, `bracket`, `dots`,
`badge`, `emoji`, `mono` — can be typed into "Other".

### Step 3 — Apply and confirm

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" set style <name>
```

Confirm: the style, the config file path, and that it is live on the next
assistant turn.

## Notes to pass on when relevant

- `CC_USAGE_MONITOR_STYLE` (environment variable) **overrides** the config
  file. If the saved style doesn't seem to take, that variable is set and
  needs unsetting.
- An unknown style name silently renders as `classic`, so a typo in a shell
  profile can never blank out the statusline.
- `style` picks a whole preset; `barStyle` (see `/cc-usage-monitor:config`)
  overrides just the bar glyphs on top of it — except on `minimal`, which
  has no bars to override, and `ascii`, which keeps its 7-bit glyphs.
- `node "${CLAUDE_PLUGIN_ROOT}/bin/config.js" reset style` goes back to
  `classic`.
