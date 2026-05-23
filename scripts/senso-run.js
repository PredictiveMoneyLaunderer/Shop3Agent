// Shared helper for running the Senso CLI from Node.js scripts.
// Uses execSync with platform-aware quoting so JSON args survive the shell.
const { execSync } = require('child_process');

function quoteArg(s) {
  if (process.platform === 'win32') {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function buildCmd(subcommand, flags, json) {
  const apiKey = process.env.SENSO_API_KEY;
  if (!apiKey) throw new Error('SENSO_API_KEY not set');
  let cmd = `senso ${subcommand}`;
  for (const flag of flags) {
    cmd += ' ' + quoteArg(flag);
  }
  if (json) cmd += ' --output json --quiet';
  return { cmd, apiKey };
}

function senso(subcommand, flags = []) {
  const { cmd, apiKey } = buildCmd(subcommand, flags, true);
  const raw = execSync(cmd, {
    env: { ...process.env, SENSO_API_KEY: apiKey },
    encoding: 'utf8',
  });
  const clean = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
  return JSON.parse(clean);
}

// For commands that don't return JSON (e.g. run-config set-*)
function sensoVoid(subcommand, flags = []) {
  const { cmd, apiKey } = buildCmd(subcommand, flags, false);
  execSync(cmd, {
    env: { ...process.env, SENSO_API_KEY: apiKey },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

module.exports = { senso, sensoVoid };
