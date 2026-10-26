#!/usr/bin/env bash
# Launch SignalBench.
#   ./run.sh                                   desktop app (Tauri dev mode)
#   ./run.sh --flash app                       ...and build + flash firmware at start-up
#   ./run.sh --flash app --scenario 00_demo_tour   ...then play a scenario
#   ./run.sh --headless [--firmware blinky] [--duration 10000]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLASH="" SCENARIO="" HEADLESS=0 FIRMWARE="app" DURATION=""

while (( $# )); do
  case "$1" in
    --flash) FLASH="$2"; shift 2 ;;
    --scenario) SCENARIO="$2"; shift 2 ;;
    --headless) HEADLESS=1; shift ;;
    --firmware) FIRMWARE="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

if (( HEADLESS )); then
  "$ROOT/build.sh" firmware
  "$ROOT/build.sh" sim
  args=(--firmware "$ROOT/firmware/build/bin/$FIRMWARE")
  [[ -n "$DURATION" ]] && args+=(--duration "$DURATION")
  echo "Running $FIRMWARE headless (Ctrl+C to stop)..."
  exec "$ROOT/sim/target/release/sbsim" "${args[@]}"
fi

cd "$ROOT/app"
[[ -d node_modules ]] || npm ci
SIGNALBENCH_AUTOFLASH="$FLASH" SIGNALBENCH_AUTOSCRIPT="$SCENARIO" npm run tauri dev
