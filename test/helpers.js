'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Run a script with the given fixture piped to stdin. Returns
 * { stdout, stderr, code } once the process exits.
 *
 * `mutate` is an optional function (parsedFixture) -> parsedFixture that
 * lets a test inject runtime-only fields (e.g. an absolute transcript_path).
 */
function runScript(scriptPath, fixtureName, env = {}, mutate = null) {
  return new Promise((resolve, reject) => {
    const fixturePath = path.join(FIXTURES_DIR, fixtureName);
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const payload = mutate ? JSON.stringify(mutate(JSON.parse(raw))) : raw;

    // Strip any CC_USAGE_MONITOR_* vars from the developer's shell so they
    // can't change test output, then point the config at a nonexistent file
    // so a real ~/.claude/cc-usage-monitor.json can't either.
    const baseEnv = { ...process.env };
    for (const key of Object.keys(baseEnv)) {
      if (key.startsWith('CC_USAGE_MONITOR_')) delete baseEnv[key];
    }
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...baseEnv,
        NO_COLOR: '1',
        CC_USAGE_MONITOR_CONFIG: path.join(FIXTURES_DIR, 'no-such-config.json'),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));

    child.stdin.write(payload);
    child.stdin.end();
  });
}

const STATUSLINE = path.join(__dirname, '..', 'bin', 'statusline.js');
const ON_STOP = path.join(__dirname, '..', 'bin', 'on-stop.js');
const TRANSCRIPT_FIXTURE = path.join(FIXTURES_DIR, 'transcript-3-turns.jsonl');
const TRANSCRIPT_FABLE = path.join(FIXTURES_DIR, 'transcript-fable.jsonl');

/** Inject the absolute transcript fixture path so the Stop hook can read it. */
function withTranscript(payload) {
  payload.transcript_path = TRANSCRIPT_FIXTURE;
  return payload;
}

/** Same, but the mixed Fable 5 + Haiku 4.5 transcript. */
function withFableTranscript(payload) {
  payload.transcript_path = TRANSCRIPT_FABLE;
  return payload;
}

module.exports = {
  runScript,
  STATUSLINE,
  ON_STOP,
  withTranscript,
  withFableTranscript,
  FIXTURES_DIR,
  TRANSCRIPT_FIXTURE,
  TRANSCRIPT_FABLE,
};
