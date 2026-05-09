#!/usr/bin/env node
'use strict';

/**
 * cc-usage-monitor self-updater.
 *
 * Runs `git pull --ff-only` in the plugin directory, reports the version
 * before/after, and reminds the user to reload Claude Code if needed.
 *
 * Designed to be invoked from the /cc-usage-monitor:update slash command
 * but works fine standalone:  node bin/update.js
 *
 * Exit codes:
 *   0   success (already up-to-date or pulled new commits)
 *   1   not a git checkout (re-clone instructions printed)
 *   2   git operation failed
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const GIT_DIR = path.join(PLUGIN_ROOT, '.git');
const REPO_URL = 'https://github.com/harveyxiacn/cc-usage-monitor.git';

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function git(cmd) {
  return execSync(`git -C "${PLUGIN_ROOT}" ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fail(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

if (!fs.existsSync(GIT_DIR)) {
  fail(
    `cc-usage-monitor at ${PLUGIN_ROOT} is not a git checkout — can't auto-update.\n\n` +
    `To switch to a git-backed install:\n` +
    `  1. rm -rf "${PLUGIN_ROOT}"\n` +
    `  2. git clone ${REPO_URL} "${PLUGIN_ROOT}"\n` +
    `  3. /reload-plugins  (or restart Claude Code)`,
    1
  );
}

const before = readVersion();
let pullOutput;

try {
  git('fetch --tags --quiet origin');
  pullOutput = git('pull --ff-only --quiet').trim();
} catch (e) {
  fail(
    `Update failed: ${e.message.split('\n')[0]}\n\n` +
    `If you have local changes, stash or reset them first:\n` +
    `  git -C "${PLUGIN_ROOT}" status\n` +
    `  git -C "${PLUGIN_ROOT}" stash\n` +
    `  /cc-usage-monitor:update`,
    2
  );
}

const after = readVersion();

if (before === after) {
  process.stdout.write(`cc-usage-monitor is already up to date (v${after}).\n`);
} else {
  process.stdout.write(`cc-usage-monitor updated: v${before} → v${after}\n\n`);
  // Show changelog header for the new version, if present.
  try {
    const changelog = fs.readFileSync(path.join(PLUGIN_ROOT, 'CHANGELOG.md'), 'utf8');
    const idx = changelog.indexOf(`## [${after}]`);
    if (idx >= 0) {
      const next = changelog.indexOf('\n## [', idx + 1);
      const slice = changelog.slice(idx, next === -1 ? undefined : next).trim();
      process.stdout.write(slice + '\n\n');
    }
  } catch { /* changelog optional */ }
  process.stdout.write(
    `The new version is live on the next assistant turn (the statusline\n` +
    `and Stop hook re-spawn each invocation). If you installed via the\n` +
    `plugin manager, run /reload-plugins to activate.\n`
  );
}
