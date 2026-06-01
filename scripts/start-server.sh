#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
EXAMPLE_ENV_FILE="$ROOT_DIR/.env.example"
MODE="local"
ENV_SOURCE_FILE=""
REQUIRED_ENV_NAMES=(WEREAD_API_KEY LLM_API_KEY)
CONFIG_ENV_NAMES=(
  WEREAD_API_KEY
  LLM_API_KEY
  LLM_API_BASE
  LLM_MODEL
  LLM_FALLBACK_MODELS
  CLIENT_TOKEN
  ENABLE_PERSONAL_SIGNALS
  PORT
  WEREAD_API_BASE
  WEREAD_SKILL_VERSION
)

usage() {
  cat <<'USAGE'
Usage:
  scripts/start-server.sh             Start the Agent server locally with npm
  scripts/start-server.sh --docker    Start the Agent server with Docker Compose

Environment:
  ENV_FILE=/path/to/.env              Override the env file path
                                      Optional in local mode when required
                                      values are already exported
  START_SERVER_KILL_OLD=0             Do not stop an old local Agent server
                                      process before starting
USAGE
}

collect_missing_required_env() {
  missing=()
  for name in "${REQUIRED_ENV_NAMES[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
}

save_exported_config_env() {
  for name in "${CONFIG_ENV_NAMES[@]}"; do
    if [[ -n "${!name:-}" ]]; then
      printf -v "START_SERVER_ORIGINAL_${name}" '%s' "${!name}"
      printf -v "START_SERVER_ORIGINAL_${name}_SET" '%s' "1"
    fi
  done
}

restore_exported_config_env() {
  local set_name
  local value_name

  for name in "${CONFIG_ENV_NAMES[@]}"; do
    set_name="START_SERVER_ORIGINAL_${name}_SET"
    value_name="START_SERVER_ORIGINAL_${name}"
    if [[ -n "${!set_name:-}" ]]; then
      export "$name=${!value_name}"
    fi
  done
}

stop_old_local_server() {
  local port="$1"
  local pid

  if [[ "${START_SERVER_KILL_OLD:-1}" == "0" ]]; then
    return
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    echo "lsof is unavailable; skipping old server cleanup for port $port." >&2
    return
  fi

  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    if should_stop_old_server_pid "$pid"; then
      stop_pid "$pid" "$port"
    else
      echo "Port $port is used by process $pid, but it does not look like this Agent server. Not killing it." >&2
    fi
  done
}

should_stop_old_server_pid() {
  local pid="$1"
  local command_line
  local cwd

  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"

  if [[ "$command_line" == *"$ROOT_DIR/server/index.js"* ]]; then
    return 0
  fi

  if [[ "$cwd" == "$ROOT_DIR" || "$cwd" == "$ROOT_DIR/"* ]]; then
    [[ "$command_line" == *"server/index.js"* ]]
    return
  fi

  return 1
}

stop_pid() {
  local pid="$1"
  local port="$2"
  local kill_cmd="${START_SERVER_KILL_CMD:-kill}"
  local attempt

  echo "Stopping old Agent server process $pid on port $port." >&2
  "$kill_cmd" "$pid" 2>/dev/null || return 0

  for attempt in 1 2 3 4 5; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return
    fi
    sleep 0.2
  done

  echo "Old Agent server process $pid did not stop after SIGTERM; sending SIGKILL." >&2
  "$kill_cmd" -9 "$pid" 2>/dev/null || true
}

case "${1:-}" in
  ""|--local|local)
    MODE="local"
    ;;
  --docker|docker)
    MODE="docker"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  collect_missing_required_env
  if [[ "$MODE" == "docker" ]] || (( ${#missing[@]} > 0 )); then
    cp "$EXAMPLE_ENV_FILE" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example. Fill WEREAD_API_KEY and LLM_API_KEY, then run this command again." >&2
    exit 1
  fi
  ENV_SOURCE_FILE="$EXAMPLE_ENV_FILE"
else
  ENV_SOURCE_FILE="$ENV_FILE"
fi

if [[ -n "$ENV_SOURCE_FILE" ]]; then
  save_exported_config_env
  set -a
  # shellcheck disable=SC1090
  source "$ENV_SOURCE_FILE"
  set +a
  restore_exported_config_env
fi

collect_missing_required_env

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required env values in %s: %s\n' "$ENV_FILE" "${missing[*]}" >&2
  exit 1
fi

if [[ "$MODE" == "docker" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for --docker mode." >&2
    exit 1
  fi

  if docker compose version >/dev/null 2>&1; then
    export SERVER_ENV_FILE="$ENV_FILE"
    exec docker compose --env-file "$ENV_FILE" up --build
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    export SERVER_ENV_FILE="$ENV_FILE"
    exec docker-compose --env-file "$ENV_FILE" up --build
  fi

  echo "Docker Compose is required for --docker mode." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( node_major < 18 )); then
  echo "Node.js 18 or newer is required. Current version: $(node -v)" >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/node_modules/express" ]]; then
  npm install
fi

stop_old_local_server "${PORT:-19763}"

exec npm start
