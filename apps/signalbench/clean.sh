#!/usr/bin/env bash
# Remove build outputs. Pass --all to also remove node_modules.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
paths=(firmware/build sim/target app/dist app/src-tauri/target)
[[ "${1:-}" == "--all" ]] && paths+=(app/node_modules)
for p in "${paths[@]}"; do
  [[ -e "$ROOT/$p" ]] && { echo "removing $p"; rm -rf "${ROOT:?}/$p"; }
done
echo "Clean."
