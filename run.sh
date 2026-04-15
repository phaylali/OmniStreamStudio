#!/bin/bash
# ============================================================
#  OmniStream Studio — Run Script
#  Usage:
#    ./run.sh           → Build full release and run (Tauri)
#    ./run.sh dev       → Launch in dev mode (Vite + Tauri)
#    ./run.sh build     → Build release bundle only (Tauri)
#    ./run.sh web       → Run web version (browser-based with Konva.js)
#    ./run.sh web:dev   → Run web version in dev mode
#    ./run.sh check     → Quick system check before running
# ============================================================

set -e
cd "$(dirname "$0")"

# Function to clean up ports and processes
cleanup_ports() {
  echo "→ Cleaning up ports and processes..."
  # Kill all node processes related to this app
  pkill -f "vite" 2>/dev/null || true
  pkill -f "server.cjs" 2>/dev/null || true
  pkill -f "node.*6969" 2>/dev/null || true
  pkill -f "node.*6970" 2>/dev/null || true
  pkill -f "omnistreamstudio" 2>/dev/null || true
  pkill -f "ffmpeg" 2>/dev/null || true
  
  # Kill any processes using the ports
  lsof -ti:6969 | xargs -r kill -9 2>/dev/null || true
  lsof -ti:6970 | xargs -r kill -9 2>/dev/null || true
  lsof -ti:1420 | xargs -r kill -9 2>/dev/null || true
  lsof -ti:1421 | xargs -r kill -9 2>/dev/null || true
  
  sleep 2
  echo "✓ Ports cleaned"
}

case "$1" in

  dev)
    cleanup_ports
    echo "→ Checking dependencies..."
    if ! command -v vainfo &>/dev/null; then
      echo "→ Installing libva-utils for VAAPI diagnostics..."
      yay -S --needed libva-utils || sudo pacman -S --needed libva-utils || echo "  ! Could not install libva-utils automatically"
    fi
    bun install
    echo "→ Launching in dev mode (Vite + Tauri)..."
    bun run tauri dev
    ;;

  build)
    cleanup_ports
    echo "→ Installing dependencies..."
    bun install
    echo "→ Building release bundle..."
    bun run tauri build
    echo "✓ Build complete. Check src-tauri/target/release/"
    ;;

  web)
    cleanup_ports
    # Additional wait to ensure ports are released
    sleep 2
    
    echo "→ Starting web version (Node.js + Vite)..."
    bun install
    
    # Start Node.js server with WebSocket + FFmpeg in background
    echo "→ Starting streaming server (port 6970)..."
    node server.cjs &
    SERVER_PID=$!
    sleep 1
    
    # Start Vite dev server
    echo "→ Starting web server (port 6969)..."
    bun run dev &
    
    echo "✓ Web version running at http://localhost:6969"
    echo "  - Use browser to access the app"
    echo "  - Streaming server running on port 6970"
    echo "  - Press Ctrl+C to stop all services"
    
    # Wait for Ctrl+C
    trap "kill $SERVER_PID 2>/dev/null; cleanup_ports; exit" SIGINT SIGTERM
    wait
    ;;

  web:dev)
    cleanup_ports
    echo "→ Starting web dev version..."
    bun install
    
    # Start Node.js server in background
    node server.cjs &
    SERVER_PID=$!
    sleep 1
    
    # Start Vite dev server
    bun run dev
    
    # Cleanup on exit
    kill $SERVER_PID 2>/dev/null || true
    cleanup_ports
    ;;

  check)
    cleanup_ports
    bash debug.sh check
    ;;

  *)
    # Default: full release build + run (Tauri)
    cleanup_ports
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