#!/usr/bin/env bash
# ServiceOS — ensure workspace package builds exist.
#
# `packages/contracts` ships its compiled output as dist/ (gitignored). A fresh
# clone or a recycled environment has no dist/, and both `next build`/`next dev`
# and the API TypeScript builds fail with "Cannot find module
# '@serviceos/contracts'". This guard rebuilds the package when needed so the
# standard `bun run dev` / `bun run build` just work.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$PROJECT_DIR/packages/contracts"

if [ ! -f "$CONTRACTS_DIR/dist/index.js" ]; then
  echo "[ensure-workspace-builds] @serviceos/contracts dist missing — building…"
  (cd "$CONTRACTS_DIR" && bun run build)
  echo "[ensure-workspace-builds] @serviceos/contracts built."
fi
