#!/usr/bin/env bash
# Build SignalBench: firmware (CMake), simulator (Cargo) and the app frontend.
#   ./build.sh                 everything
#   ./build.sh firmware|sim|app
#   ./build.sh app --bundle    also produce a desktop installer (tauri build)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONLY="${1:-all}"
BUNDLE="${2:-}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

build_firmware() {
  if [[ ! -f "$ROOT/firmware/build/CMakeCache.txt" ]]; then
    step "Configure firmware"
    cmake -S "$ROOT/firmware" -B "$ROOT/firmware/build"
  fi
  step "Build firmware, examples and tests"
  cmake --build "$ROOT/firmware/build" -j
}

build_sim() {
  step "Build simulator + sbsim"
  cargo build --release --manifest-path "$ROOT/sim/Cargo.toml"
}

build_app() {
  cd "$ROOT/app"
  [[ -d node_modules ]] || { step "Install app dependencies"; npm ci; }
  if [[ "$BUNDLE" == "--bundle" ]]; then
    step "Build desktop app bundle"; npm run tauri build
  else
    step "Build app frontend"; npm run build
    step "Check Tauri shell"; cargo check --manifest-path src-tauri/Cargo.toml
  fi
  cd "$ROOT"
}

case "$ONLY" in
  all)      build_firmware; build_sim; build_app ;;
  firmware) build_firmware ;;
  sim)      build_sim ;;
  app)      build_app ;;
  *) echo "usage: $0 [all|firmware|sim|app] [--bundle]" >&2; exit 2 ;;
esac
printf '\n\033[32mBuild complete.\033[0m\n'
