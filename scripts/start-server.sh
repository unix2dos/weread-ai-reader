#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
EXAMPLE_ENV_FILE="$ROOT_DIR/.env.example"
MODE="local"

usage() {
  cat <<'USAGE'
Usage:
  scripts/start-server.sh             Start the Agent server locally with npm
  scripts/start-server.sh --docker    Start the Agent server with Docker Compose

Environment:
  ENV_FILE=/path/to/.env              Override the env file path
USAGE
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
  cp "$EXAMPLE_ENV_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example. Fill WEREAD_API_KEY and LLM_API_KEY, then run this command again." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

missing=()
for name in WEREAD_API_KEY LLM_API_KEY; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

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

exec npm start
