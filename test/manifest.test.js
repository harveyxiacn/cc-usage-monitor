'use strict';

/**
 * The version string lives in three manifests that are edited by hand.
 * A release that bumps only two of them ships a plugin whose marketplace
 * entry, plugin manifest, and `/cc-usage-monitor:update` output disagree —
 * so assert they match before anything else runs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('manifests: package.json, plugin.json and marketplace.json agree on the version', () => {
  const pkg = read('package.json');
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.version, pkg.version, 'plugin.json version drifted');
  assert.equal(market.version, pkg.version, 'marketplace.json version drifted');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].version, pkg.version, 'marketplace plugin entry version drifted');
  assert.equal(market.plugins[0].name, plugin.name);
});

test('manifests: CHANGELOG has a section for the current version', () => {
  const pkg = read('package.json');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(`## [${pkg.version}]`), `CHANGELOG.md lacks a "## [${pkg.version}]" heading`);
});

test('manifests: every slash command file has front-matter with a description', () => {
  const dir = path.join(root, 'commands');
  for (const f of fs.readdirSync(dir)) {
    // Normalise CRLF so a Windows checkout with core.autocrlf=true still passes.
    const body = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(body.startsWith('---\n'), `${f} does not open with front-matter`);
    const frontMatter = body.slice(4, body.indexOf('\n---', 4));
    assert.match(frontMatter, /^description: \S.+$/m, `${f} front-matter lacks a description`);
  }
});
