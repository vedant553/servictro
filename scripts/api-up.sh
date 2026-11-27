#!/usr/bin/env bash
# Idempotent ServiceOS API+worker bootstrap for the current sandbox session.
# Safe to run repeatedly: starts processes only when :4000 is not answering.
# Used by bash sessions; the Next.js instrumentation hook calls the same logic
# in-process (src/instrumentation.ts) so the preview always has a live API.
set -uo pipefail

API_DIR="/home/z/my-project/mini-services/serviceos-api"
LOG_DIR="/tmp"

api_up() {
  curl -s --max-time 2 http://127.0.0.1:4000/health/live >/dev/null 2>&1
}

if api_up; then
  echo "[api-up] already running"
  exit 0
fi

cd "$API_DIR"
set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

nohup node --enable-source-maps dist/main.js   >"$LOG_DIR/serviceos-api.log"   2>&1 </dev/null &
nohup node --enable-source-maps dist/worker.js >"$LOG_DIR/serviceos-worker.log" 2>&1 </dev/null &

for _ in $(seq 1 40); do
  if api_up; then
    echo "[api-up] API ready on :4000"
    exit 0
  fi
  sleep 0.5
done

echo "[api-up] FAILED to start API" >&2
exit 1
