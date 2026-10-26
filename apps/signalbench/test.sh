#!/usr/bin/env bash
# Run every test layer: firmware unit tests, simulator tests, SIL scenarios.
#   ./test.sh                     all
#   ./test.sh unit|sim|sil
#   ./test.sh sil 03_short_retry_lockout     one scenario, full log
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONLY="${1:-all}"
SCENARIO="${2:-}"
FAILED=()

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
run() { local name="$1"; shift; step "$name"; "$@" || { FAILED+=("$name"); printf '\033[31mFAILED: %s\033[0m\n' "$name"; }; }

case "$ONLY" in
  unit) "$ROOT/build.sh" firmware ;;
  sim)  "$ROOT/build.sh" sim ;;
  all|sil) "$ROOT/build.sh" firmware && "$ROOT/build.sh" sim ;;
  *) echo "usage: $0 [all|unit|sim|sil] [scenario]" >&2; exit 2 ;;
esac || exit 1

if [[ "$ONLY" == all || "$ONLY" == unit ]]; then
  run "Firmware unit tests (Unity)" ctest --test-dir "$ROOT/firmware/build" --output-on-failure
fi
if [[ "$ONLY" == all || "$ONLY" == sim ]]; then
  run "Simulator tests" cargo test --release --manifest-path "$ROOT/sim/Cargo.toml"
fi
if [[ "$ONLY" == all || "$ONLY" == sil ]]; then
  args=(--firmware "$ROOT/firmware/build/bin/app")
  if [[ -n "$SCENARIO" ]]; then
    args+=(--script "$ROOT/firmware/scenarios/$SCENARIO.sbs")
  else
    args+=(--quiet)
    for f in "$ROOT"/firmware/scenarios/*.sbs; do args+=(--script "$f"); done
  fi
  run "SIL scenarios" "$ROOT/sim/target/release/sbsim" "${args[@]}"
fi

if (( ${#FAILED[@]} )); then
  printf '\n\033[31m%d test stage(s) failed: %s\033[0m\n' "${#FAILED[@]}" "${FAILED[*]}"
  exit 1
fi
printf '\n\033[32mAll tests passed.\033[0m\n'
