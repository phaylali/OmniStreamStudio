#!/bin/bash
# ============================================================
#  OmniStream Studio — Run Script
#  Usage:
#    ./run.sh           → Build full release and run
#    ./run.sh dev       → Launch in dev mode (Vite + Tauri)
#    ./run.sh build     → Build release bundle only
#    ./run.sh check     → Quick system check before running
# ============================================================

set -e
cd "$(dirname "$0")"

case "$1" in

  dev)
    echo "→ Checking dependencies..."
    if ! command -v vainfo &>/dev/null; then
      echo "→ Installing libva-utils for VAAPI diagnostics..."
      yay -S --needed libva-utils || sudo pacman -S --needed libva-utils || echo "  ! Could not install libva-utils automatically"
    fi
    bun install
    echo "→ Launching in dev mode (Vite + Tauri)..."
    # 'bun run tauri dev' automatically starts Vite (beforeDevCommand)
    # then waits for it before opening Tauri — no separate terminals needed.
    bun run tauri dev
    ;;

  build)
    echo "→ Installing dependencies..."
    bun install
    echo "→ Building release bundle..."
    # Use 'bun run tauri build' — this bundles the frontend INTO the binary.
    # Do NOT use 'cargo build --release' directly, it won't embed the frontend.
    bun run tauri build
    echo "✓ Build complete. Check src-tauri/target/release/"
    ;;

  check)
    bash debug.sh check
    ;;

  *)
    # Default: full release build + run
    echo "→ Checking dependencies..."
    if ! command -v vainfo &>/dev/null; then
      echo "→ Installing libva-utils for VAAPI diagnostics..."
      yay -S --needed libva-utils || sudo pacman -S --needed libva-utils || echo "  ! Could not install libva-utils automatically"
    fi
    bun install

    echo "→ Building release..."
    bun run tauri build

    echo "→ Launching..."
    ./src-tauri/target/release/omnistreamstudio
    ;;

esac