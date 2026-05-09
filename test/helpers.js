'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Run a script with the given fixture piped to stdin. Returns
 * { stdout, stderr, code } once the process exits.
 */
function runScript(scriptPath, fixtureName, env = {}) {
  return new Promise((resolve, reject) => {
    const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
    const fixture = fs.readFileSync(fixturePath, 'utf8');

    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));

    child.stdin.write(fixture);
    child.stdin.end();
  });
}

const STATUSLINE = path.join(__dirname, '..', 'bin', 'statusline.js');
const ON_STOP = path.join(__dirname, '..', 'bin', 'on-stop.js');

module.exports = { runScript, STATUSLINE, ON_STOP };
