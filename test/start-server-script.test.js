const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { chmod, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT_DIR = join(__dirname, '..');
const SCRIPT_PATH = join(ROOT_DIR, 'scripts', 'start-server.sh');

async function createFakeRuntime() {
  const tempDir = mkdtempSync(join(tmpdir(), 'weread-start-server-'));
  const binDir = join(tempDir, 'bin');
  const npmArgsFile = join(tempDir, 'npm-args.txt');

  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, 'node'), [
    '#!/usr/bin/env bash',
    'if [[ "$1" == "-p" ]]; then',
    '  echo "20"',
    '  exit 0',
    'fi',
    'echo "unexpected node invocation: $*" >&2',
    'exit 64',
    ''
  ].join('\n'));
  await writeFile(join(binDir, 'npm'), [
    '#!/usr/bin/env bash',
    '{',
    '  printf "args=%s\\n" "$*"',
    '  printf "LLM_API_BASE=%s\\n" "${LLM_API_BASE:-}"',
    '  printf "LLM_MODEL=%s\\n" "${LLM_MODEL:-}"',
    '} > "$START_SERVER_TEST_NPM_ARGS"',
    'exit 0',
    ''
  ].join('\n'));
  await chmod(join(binDir, 'node'), 0o755);
  await chmod(join(binDir, 'npm'), 0o755);

  return {
    tempDir,
    binDir,
    npmArgsFile,
    cleanup: () => rm(tempDir, { recursive: true, force: true })
  };
}

function runStartServer({ binDir, envFile, npmArgsFile, extraEnv = {} }) {
  return spawnSync('bash', [SCRIPT_PATH], {
    cwd: ROOT_DIR,
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      ENV_FILE: envFile,
      START_SERVER_TEST_NPM_ARGS: npmArgsFile,
      WEREAD_API_KEY: 'wrk-global',
      LLM_API_KEY: 'sk-global',
      ...extraEnv
    },
    encoding: 'utf8'
  });
}

test('start-server uses exported keys when the local env file is missing', async () => {
  const runtime = await createFakeRuntime();
  const envFile = join(runtime.tempDir, 'missing.env');

  try {
    const result = runStartServer({
      binDir: runtime.binDir,
      envFile,
      npmArgsFile: runtime.npmArgsFile
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(envFile), false);
    const npmEnv = readFileSync(runtime.npmArgsFile, 'utf8');
    assert.match(npmEnv, /^args=start$/m);
    assert.match(npmEnv, /^LLM_API_BASE=https:\/\/opencode\.ai\/zen\/go\/v1$/m);
    assert.match(npmEnv, /^LLM_MODEL=mimo-v2\.5$/m);
    assert.doesNotMatch(result.stderr, /Created .* from \.env\.example/);
  } finally {
    await runtime.cleanup();
  }
});

test('start-server keeps exported required keys when env file has blank placeholders', async () => {
  const runtime = await createFakeRuntime();
  const envFile = join(runtime.tempDir, 'placeholder.env');
  writeFileSync(envFile, 'WEREAD_API_KEY=\nLLM_API_KEY=\nPORT=19763\n');

  try {
    const result = runStartServer({
      binDir: runtime.binDir,
      envFile,
      npmArgsFile: runtime.npmArgsFile
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(runtime.npmArgsFile, 'utf8'), /^args=start$/m);
    assert.doesNotMatch(result.stderr, /Missing required env values/);
  } finally {
    await runtime.cleanup();
  }
});
