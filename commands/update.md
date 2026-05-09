---
description: Update cc-usage-monitor to the latest version from GitHub
allowed-tools: Bash(node*)
---

# /update

Pull the latest cc-usage-monitor from GitHub.

Run exactly this and show the output verbatim — do not summarise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/update.js"
```

If the script reports an old → new version, mention that the new version
takes effect on the next assistant turn (no reload needed for direct
`settings.json` installs; users who installed via the plugin manager
should run `/reload-plugins` to activate it immediately).

If the script reports it's already up to date, just say so — no further
action needed.

If the script exits non-zero (not a git checkout, or git pull failed),
relay the error message to the user verbatim — it contains the recovery
instructions.
