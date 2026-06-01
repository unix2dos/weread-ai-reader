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
  const killLogFile = join(tempDir, 'kill-log.txt');

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
  await writeFile(join(binDir, 'lsof'), [
    '#!/usr/bin/env bash',
    'if [[ "$*" == "-tiTCP:${START_SERVER_TEST_PORT:-19763} -sTCP:LISTEN" ]]; then',
    '  if [[ -n "${START_SERVER_TEST_LISTENER_PID:-}" ]]; then',
    '    echo "$START_SERVER_TEST_LISTENER_PID"',
    '  fi',
    '  exit 0',
    'fi',
    'if [[ "$*" == "-a -p ${START_SERVER_TEST_LISTENER_PID:-} -d cwd -Fn" ]]; then',
    '  printf "p%s\\n" "$START_SERVER_TEST_LISTENER_PID"',
    '  printf "n%s\\n" "$START_SERVER_TEST_LISTENER_CWD"',
    '  exit 0',
    'fi',
    'exit 0',
    ''
  ].join('\n'));
  await writeFile(join(binDir, 'ps'), [
    '#!/usr/bin/env bash',
    'if [[ "$*" == "-p ${START_SERVER_TEST_LISTENER_PID:-} -o command=" ]]; then',
    '  printf "%s\\n" "$START_SERVER_TEST_LISTENER_COMMAND"',
    '  exit 0',
    'fi',
    'exit 1',
    ''
  ].join('\n'));
  await writeFile(join(binDir, 'fake-kill'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$*" >> "$START_SERVER_TEST_KILL_LOG"',
    'exit 0',
    ''
  ].join('\n'));
  await chmod(join(binDir, 'node'), 0o755);
  await chmod(join(binDir, 'npm'), 0o755);
  await chmod(join(binDir, 'lsof'), 0o755);
  await chmod(join(binDir, 'ps'), 0o755);
  await chmod(join(binDir, 'fake-kill'), 0o755);

  return {
    tempDir,
    binDir,
    npmArgsFile,
    killLogFile,
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
      START_SERVER_TEST_KILL_LOG: join(binDir, '..', 'kill-log.txt'),
      START_SERVER_KILL_CMD: join(binDir, 'fake-kill'),
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

test('start-server stops an old local server process on the configured port', async () => {
  const runtime = await createFakeRuntime();
  const envFile = join(runtime.tempDir, 'server.env');
  writeFileSync(envFile, 'WEREAD_API_KEY=\nLLM_API_KEY=\nPORT=19888\n');

  try {
    const result = runStartServer({
      binDir: runtime.binDir,
      envFile,
      npmArgsFile: runtime.npmArgsFile,
      extraEnv: {
        START_SERVER_TEST_PORT: '19888',
        START_SERVER_TEST_LISTENER_PID: '4242',
        START_SERVER_TEST_LISTENER_CWD: ROOT_DIR,
        START_SERVER_TEST_LISTENER_COMMAND: 'node server/index.js'
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Stopping old Agent server process 4242 on port 19888/);
    assert.match(readFileSync(runtime.killLogFile, 'utf8'), /^4242$/m);
    assert.match(readFileSync(runtime.npmArgsFile, 'utf8'), /^args=start$/m);
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
