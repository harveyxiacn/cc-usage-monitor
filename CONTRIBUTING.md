# Contributing

Thanks for your interest in cc-usage-monitor!

## Quick start

```bash
git clone https://github.com/harveyxiacn/cc-usage-monitor.git
cd cc-usage-monitor
npm test
```

There are no `node_modules` to install — the test suite uses only Node's
built-in `node:test` runner. Node 18 or newer is required.

## Project layout

```
.claude-plugin/    Plugin + marketplace manifests
bin/               Executable scripts (statusline, Stop hook)
commands/          Slash command definitions
hooks/             Hook event registrations (hooks.json)
lib/               Shared helpers (no I/O)
test/              node:test files + JSON fixtures
docs/              Design + architecture notes
```

Keep `lib/` pure (no stdin/stdout, no fs) so it can be unit-tested cheaply,
and let `bin/` scripts handle I/O.

## Running locally during development

```bash
# Statusline against a fixture
FORCE_COLOR=1 node bin/statusline.js < test/fixtures/full.json

# Stop hook against a fixture
FORCE_COLOR=1 node bin/on-stop.js < test/fixtures/full.json
```

To try it inside Claude Code without installing globally:

```bash
claude --plugin-dir .
```

Then reload with `/reload-plugins` after each change.

## Tests

```bash
npm test
```

If you add a new fixture, drop it into `test/fixtures/` and add a test in
`test/statusline.test.js` and/or `test/on-stop.test.js`. Tests pipe the
fixture into the script via `child_process.spawn` and assert against
stdout/stderr.

Always set `NO_COLOR: '1'` in test env (already done in `test/helpers.js`) so
matchers work against plain text.

## Code style

- **No external runtime deps.** This plugin must work with `git clone && node bin/...`
  on a vanilla machine. Build-time / dev deps are fine if needed for tests, but
  prefer not to add any.
- Two-space indent, single quotes, semicolons (see `.editorconfig`).
- Keep `lib/` modules side-effect-free. I/O lives in `bin/`.

## Releasing

1. Bump the version in `package.json`, `.claude-plugin/plugin.json`, and
   `.claude-plugin/marketplace.json`.
2. Update `CHANGELOG.md`.
3. `git tag vX.Y.Z && git push --tags`.
4. Create a GitHub release pointing at the tag.

## Reporting issues

When filing a bug, include:

- The output of `claude --version`
- Your OS + shell
- A redacted snippet of the JSON Claude Code is piping to the script (run
  the statusline command manually with `< test/fixtures/full.json` to confirm
  the script itself works)

## License

By contributing, you agree your contributions will be licensed under the MIT
License.
