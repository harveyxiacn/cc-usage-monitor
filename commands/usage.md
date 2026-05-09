---
description: Show the current 5-hour and 7-day Claude Code rate-limit usage with extras
allowed-tools: Bash(npx ccusage*), Bash(node*)
---

# /usage

Run a detailed Claude Code usage report covering both rate-limit windows and
extra context.

## Step 1 — Active 5-hour block

Run this exact command and show the output:

```bash
npx ccusage@latest blocks --active --json
```

Pull out:

- `tokenCounts` (input, output, cache create, cache read)
- `costUSD`
- `endTime` (epoch ms — convert to a human "X hours Y minutes from now")

If `ccusage` is not installed, fall back to summarising the most recent block
visible in `~/.claude/projects/`.

## Step 2 — Last 7 days

Run:

```bash
npx ccusage@latest daily --since $(node -e "console.log(new Date(Date.now()-7*86400000).toISOString().slice(0,10))") --json
```

Sum the per-day token + cost totals to give a rolling 7-day picture. Compare
against the user's known plan tier if they've shared it; otherwise just show
the totals.

## Step 3 — Render the report

Output a markdown table summarising:

| Window | Tokens used | Cost | Resets in |
| ------ | ----------- | ---- | --------- |
| 5-hour | …           | …    | …         |
| 7-day  | …           | …    | rolling   |

Then a one-line "extras" footer with the active model and the path of the
session log being read.

Keep it under ~200 lines of output.
