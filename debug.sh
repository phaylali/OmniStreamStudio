#!/bin/bash
# ============================================================
#  OmniStream Studio — Debug CLI Toolkit
#  Usage: ./debug.sh [command]
# ============================================================

set -e
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SEP="${CYAN}────────────────────────────────────────────────────${NC}"

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${YELLOW}→${NC} $1"; }
header() { echo -e "\n${SEP}\n  ${BOLD}$1${NC}\n${SEP}"; }

# ── HELP ─────────────────────────────────────────────────────
show_help() {
  echo -e "\n${BOLD}OmniStream Studio — Debug CLI${NC}"
  echo ""
  echo "  ./debug.sh check        Run full system/env check"
  echo "  ./debug.sh encoders     Detect & test all available FFmpeg encoders"
  echo "  ./debug.sh vaapi        Test VAAPI device specifically"
  echo "  ./debug.sh capture      Test screen capture pipeline (5 seconds, no stream)"
  echo "  ./debug.sh network      Test RTMP connectivity to Twitch/Kick ingests"
  echo "  ./debug.sh vite         Check if Vite dev server is running on port 1420"
  echo "  ./debug.sh fix-dev      Fix and launch the dev environment correctly"
  echo "  ./debug.sh stream-test  Dry-run a stream (no actual upload, saves to /tmp)"
  echo "  ./debug.sh logs         Show recent Tauri/FFmpeg logs"
  echo "  ./debug.sh kill         Kill any running FFmpeg or Tauri processes"
  echo ""
}

# ── CHECK ────────────────────────────────────────────────────
cmd_check() {
  header "System & Environment Check"

  # OS
  info "OS: $(uname -srm)"

  # FFmpeg
  if command -v ffmpeg &>/dev/null; then
    FF_VER=$(ffmpeg -version 2>&1 | head -1)
    pass "FFmpeg: $FF_VER"
  else
    fail "FFmpeg NOT FOUND — install it: sudo pacman -S ffmpeg  OR  sudo apt install ffmpeg"
  fi

  # Bun
  if command -v bun &>/dev/null; then
    pass "Bun: $(bun --version)"
  else
    fail "Bun not found"
  fi

  # Cargo / Rust
  if command -v cargo &>/dev/null; then
    pass "Rust/Cargo: $(cargo --version)"
  else
    fail "Rust/Cargo not found"
  fi

  # Node modules
  if [ -d node_modules ]; then
    pass "node_modules present"
  else
    fail "node_modules missing — run: bun install"
  fi

  # .env
  if [ -f .env ]; then
    pass ".env file found"
    if grep -q "TWITCH_KEY=" .env && [ -n "$(grep 'TWITCH_KEY=' .env | cut -d= -f2)" ]; then
      pass "TWITCH_KEY is set"
    else
      fail "TWITCH_KEY is empty or missing in .env"
    fi
    if grep -q "TWITCH_USERNAME=" .env; then
      TW_USER=$(grep 'TWITCH_USERNAME=' .env | cut -d= -f2)
      pass "TWITCH_USERNAME: $TW_USER"
    fi
  else
    fail ".env file MISSING — copy .env.example and fill in your keys"
  fi

  # tauri.conf.json frontendDist sanity
  FD=$(grep -o '"frontendDist": *"[^"]*"' src-tauri/tauri.conf.json | grep -o '"[^"]*"$' | tr -d '"')
  info "tauri.conf.json frontendDist: $FD"
  if [ "$FD" = "../dist" ]; then
    pass "frontendDist points to ../dist (correct)"
  else
    fail "frontendDist is '$FD' — expected '../dist'. This will cause dev connection issues!"
  fi

  # dist folder
  if [ -d dist ]; then
    pass "dist/ folder exists (built frontend)"
  else
    info "dist/ not built yet — run: bun run build"
  fi

  # GPU hardware
  header "GPU Detection"
  if command -v lspci &>/dev/null; then
    GPU_LIST=$(lspci | grep -i "VGA compatible controller" || echo "none detected")
    echo "  $GPU_LIST"
  else
    info "lspci not available"
  fi

  if command -v nvidia-smi &>/dev/null; then
    pass "nvidia-smi found: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'N/A')"
  fi

  # DRI devices (VAAPI)
  if ls /dev/dri/renderD* &>/dev/null; then
    pass "DRI render devices: $(ls /dev/dri/renderD*)"
  else
    fail "/dev/dri/renderD* not found — VAAPI likely unavailable"
  fi

  # Port 1420
  header "Port Check"
  if ss -tlnp 2>/dev/null | grep -q ':1420'; then
    pass "Port 1420 is OPEN — Vite dev server is running"
  else
    fail "Port 1420 is CLOSED — Vite dev server is NOT running"
    info "This is why Tauri shows 'Connection refused' in dev mode"
    info "Fix: run './debug.sh fix-dev' OR './run.sh dev'"
  fi
}

# ── ENCODERS ─────────────────────────────────────────────────
cmd_encoders() {
  header "FFmpeg Encoder Detection"

  if ! command -v ffmpeg &>/dev/null; then
    fail "FFmpeg not found"; exit 1
  fi

  ENCODERS=$(ffmpeg -hide_banner -encoders 2>&1)

  echo ""
  check_encoder() {
    local name=$1 label=$2
    if echo "$ENCODERS" | grep -q " $name "; then
      pass "$label ($name) — available in FFmpeg"
    else
      fail "$label ($name) — NOT in FFmpeg build"
    fi
  }

  check_encoder "libx264"    "Software x264 (CPU)"
  check_encoder "h264_amf"   "AMD VCE"
  check_encoder "h264_nvenc" "NVIDIA NVENC"
  check_encoder "h264_qsv"   "Intel QuickSync"
  check_encoder "h264_vaapi" "VAAPI (open-source AMD/Intel)"

  header "Quick Encoder Smoke Tests"
  info "Each test encodes 1 second of test video — failures mean that encoder won't work"

  test_encoder() {
    local codec=$1 label=$2 extra_args=$3
    printf "  Testing %-30s ... " "$label ($codec)"
    if ffmpeg -hide_banner -loglevel error \
        -f lavfi -i testsrc=duration=1:size=1280x720:rate=30 \
        -f lavfi -i sine=frequency=440:duration=1 \
        $extra_args \
        -c:v "$codec" -b:v 2500k \
        -c:a aac -b:a 128k \
        -t 1 -f null - 2>/tmp/omni_enc_test.log; then
      echo -e "${GREEN}PASS${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      echo "    └─ $(tail -3 /tmp/omni_enc_test.log | head -1)"
    fi
  }

  test_encoder "libx264"    "CPU Software" "-preset ultrafast -tune zerolatency"
  
  if echo "$ENCODERS" | grep -q " h264_amf "; then
    test_encoder "h264_amf"   "AMD VCE"     "-quality balanced"
  fi
  
  if echo "$ENCODERS" | grep -q " h264_nvenc "; then
    test_encoder "h264_nvenc" "NVIDIA NVENC" "-preset fast"
  fi
  
  if echo "$ENCODERS" | grep -q " h264_qsv "; then
    test_encoder "h264_qsv"   "Intel QSV"   "-preset fast"
  fi
  
  if echo "$ENCODERS" | grep -q " h264_vaapi "; then
    printf "  Testing %-30s ... " "VAAPI"
    if ffmpeg -hide_banner -loglevel error \
        -vaapi_device /dev/dri/renderD128 \
        -f lavfi -i testsrc=duration=1:size=1280x720:rate=30 \
        -vf 'format=nv12,hwupload' \
        -c:v h264_vaapi -b:v 2500k \
        -f null - 2>/tmp/omni_vaapi_test.log; then
      echo -e "${GREEN}PASS${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      echo "    └─ $(tail -3 /tmp/omni_vaapi_test.log | head -1)"
    fi
  fi
}

# ── VAAPI ────────────────────────────────────────────────────
cmd_vaapi() {
  header "VAAPI Deep Diagnostic"

  if ! ls /dev/dri/renderD* &>/dev/null; then
    fail "/dev/dri/renderD* not found — no VAAPI device"
    exit 1
  fi

  for dev in /dev/dri/renderD*; do
    info "Testing device: $dev"
    if ! command -v vainfo &>/dev/null; then
      info "Installing libva-utils for diagnostics..."
      yay -S --needed libva-utils || sudo pacman -S --needed libva-utils || fail "Could not install libva-utils"
    fi

    if command -v vainfo &>/dev/null; then
      vainfo --display drm --device "$dev" 2>&1 | grep -E "(profile|entrypoint|VAProfile|error)" | head -20
    else
      fail "vainfo still not available"
    fi

    printf "  FFmpeg VAAPI encode test on $dev ... "
    if ffmpeg -hide_banner -loglevel error \
        -vaapi_device "$dev" \
        -f lavfi -i testsrc=duration=1:size=1280x720:rate=30 \
        -vf 'format=nv12,hwupload' \
        -c:v h264_vaapi -b:v 2500k \
        -f null - 2>/tmp/omni_vaapi_deep.log; then
      echo -e "${GREEN}PASS — $dev works!${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      cat /tmp/omni_vaapi_deep.log | tail -5
    fi
  done
}

# ── CAPTURE ──────────────────────────────────────────────────
cmd_capture() {
  header "Screen Capture Pipeline Test (5 seconds)"
  info "Capturing via x11grab → encoding with libx264 → /tmp/capture_test.mp4"
  info "This tests the capture pipeline WITHOUT streaming"

  DISPLAY_VAR="${DISPLAY:-:0}"
  info "Using DISPLAY=$DISPLAY_VAR"

  ffmpeg -hide_banner -loglevel info \
    -f x11grab \
    -framerate 30 \
    -draw_mouse 1 \
    -video_size 1920x1080 \
    -i "$DISPLAY_VAR" \
    -f pulse -i auto \
    -vf scale=1280:720:flags=fast_bilinear \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -b:v 2500k \
    -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -t 5 \
    /tmp/capture_test.mp4 -y 2>&1 | tail -20

  if [ -f /tmp/capture_test.mp4 ]; then
    SIZE=$(du -h /tmp/capture_test.mp4 | cut -f1)
    pass "Capture test saved to /tmp/capture_test.mp4 ($SIZE)"
  else
    fail "Capture test FAILED — check output above"
  fi
}

# ── NETWORK ──────────────────────────────────────────────────
cmd_network() {
  header "RTMP Ingest Network Check"

  test_ingest() {
    local name=$1 host=$2 port=${3:-443}
    printf "  %-40s ... " "$name ($host:$port)"
    if timeout 5 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null; then
      echo -e "${GREEN}REACHABLE${NC}"
    else
      echo -e "${RED}UNREACHABLE${NC}"
    fi
  }

  echo ""
  echo -e "  ${BOLD}Twitch Ingests:${NC}"
  test_ingest "Auto / Global"        "ingest.global-contribute.live-video.net"
  test_ingest "Europe (Paris)"       "euw30.contribute.live-video.net"
  test_ingest "Europe (Frankfurt)"   "euc10.contribute.live-video.net"
  test_ingest "Europe (Ireland)"     "euw10.contribute.live-video.net"
  test_ingest "US East (Virginia)"   "use10.contribute.live-video.net"

  echo ""
  echo -e "  ${BOLD}Kick Ingests:${NC}"
  test_ingest "Kick Default"         "live-kick.edge.kick.com"

  echo ""
  info "Note: These test TCP connectivity on port 443 (RTMPS). A passing test means the"
  info "      ingest server is reachable from your network."
}

# ── VITE ─────────────────────────────────────────────────────
cmd_vite() {
  header "Vite Dev Server Check"

  if ss -tlnp 2>/dev/null | grep -q ':1420'; then
    pass "Vite is RUNNING on port 1420"
    info "You can open http://localhost:1420 in a browser to see the UI"
  else
    fail "Vite is NOT running on port 1420"
    info "This causes 'Connection refused' in Tauri dev mode"
    echo ""
    info "To fix, run in a terminal:  bun run dev"
    info "Then in another terminal:   cd src-tauri && cargo tauri dev"
    info "   OR just use:             ./run.sh dev"
  fi
}

# ── FIX-DEV ──────────────────────────────────────────────────
cmd_fix_dev() {
  header "Fixing Dev Environment"

  info "Installing npm dependencies..."
  bun install

  info "Cleaning dist folder..."
  rm -rf dist

  info "Verify tauri.conf.json frontendDist..."
  FD=$(grep -o '"frontendDist": *"[^"]*"' src-tauri/tauri.conf.json | grep -o '"[^"]*"$' | tr -d '"')
  if [ "$FD" != "../dist" ]; then
    fail "frontendDist is '$FD' — fixing to '../dist'..."
    sed -i 's|"frontendDist": *"[^"]*"|"frontendDist": "../dist"|' src-tauri/tauri.conf.json
    pass "Fixed frontendDist in tauri.conf.json"
  else
    pass "frontendDist is correct"
  fi

  echo ""
  echo -e "${BOLD}${GREEN}Ready! Now run:${NC}"
  echo -e "  ${CYAN}bun run tauri dev${NC}    (launches Vite + Tauri together)"
  echo ""
  echo -e "  Or manually in two terminals:"
  echo -e "  Terminal 1: ${CYAN}bun run dev${NC}          (starts Vite on :1420)"
  echo -e "  Terminal 2: ${CYAN}cd src-tauri && cargo run${NC}"
}

# ── STREAM-TEST ───────────────────────────────────────────────
cmd_stream_test() {
  header "Stream Dry-Run (saves to /tmp, no upload)"
  info "Tests the full pipeline: capture → encode → mux FLV → /tmp/stream_test.flv (10s)"

  ENCODER="libx264"
  EXTRA_ARGS="-preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p"

  # Try GPU first
  FFMPEG_ENCODERS=$(ffmpeg -hide_banner -encoders 2>&1)
  if echo "$FFMPEG_ENCODERS" | grep -q " h264_vaapi "; then
    printf "  Testing VAAPI first ... "
    if ffmpeg -hide_banner -loglevel error \
        -vaapi_device /dev/dri/renderD128 \
        -f lavfi -i testsrc=duration=1:size=1280x720:rate=30 \
        -vf 'format=nv12,hwupload' \
        -c:v h264_vaapi -b:v 2500k -f null - 2>/dev/null; then
      ENCODER="h264_vaapi"
      EXTRA_ARGS="-rc_mode CBR"
      echo -e "${GREEN}GPU (VAAPI) works${NC}"
    else
      echo -e "${YELLOW}failed, using CPU${NC}"
    fi
  elif echo "$FFMPEG_ENCODERS" | grep -q " h264_amf "; then
    ENCODER="h264_amf"
    EXTRA_ARGS="-quality balanced"
    info "Using AMD VCE (h264_amf)"
  elif echo "$FFMPEG_ENCODERS" | grep -q " h264_nvenc "; then
    ENCODER="h264_nvenc"
    EXTRA_ARGS="-preset fast"
    info "Using NVIDIA NVENC"
  fi

  info "Encoder selected: $ENCODER"
  info "Capturing 10 seconds → /tmp/stream_test.flv"

  DISPLAY_VAR="${DISPLAY:-:0}"

  if [ "$ENCODER" = "h264_vaapi" ]; then
    ffmpeg -hide_banner -loglevel info \
      -vaapi_device /dev/dri/renderD128 \
      -f x11grab -framerate 30 -draw_mouse 1 -video_size 1920x1080 -i "$DISPLAY_VAR" \
      -f pulse -i auto \
      -vf 'format=nv12,hwupload' \
      -c:v h264_vaapi $EXTRA_ARGS \
      -b:v 2500k -maxrate 3000k -bufsize 5000k -g 60 \
      -c:a aac -b:a 192k -ar 48000 -ac 2 \
      -f flv -t 10 /tmp/stream_test.flv -y 2>&1 | tail -30
  else
    ffmpeg -hide_banner -loglevel info \
      -f x11grab -framerate 30 -draw_mouse 1 -video_size 1920x1080 -i "$DISPLAY_VAR" \
      -f pulse -i auto \
      -vf scale=1280:720:flags=fast_bilinear \
      -c:v "$ENCODER" $EXTRA_ARGS \
      -b:v 2500k -maxrate 3000k -bufsize 5000k -g 60 \
      -c:a aac -b:a 192k -ar 48000 -ac 2 \
      -f flv -t 10 /tmp/stream_test.flv -y 2>&1 | tail -30
  fi

  if [ -f /tmp/stream_test.flv ]; then
    SIZE=$(du -h /tmp/stream_test.flv | cut -f1)
    pass "Stream test output: /tmp/stream_test.flv ($SIZE)"
    info "Play it with: ffplay /tmp/stream_test.flv"
  else
    fail "Stream test FAILED — see output above"
  fi
}

# ── LOGS ─────────────────────────────────────────────────────
cmd_logs() {
  header "Recent Logs"

  LOG_DIRS=(
    "$HOME/.local/share/com.omnistream.studio/logs"
    "$HOME/.config/com.omnistream.studio/logs"
    "/tmp/omni_*.log"
  )

  FOUND=0
  for dir in "${LOG_DIRS[@]}"; do
    if ls $dir 2>/dev/null | head -1 | grep -q .; then
      info "Found logs in: $dir"
      ls -lt $dir 2>/dev/null | head -5
      FOUND=1
      echo ""
      info "Latest log:"
      tail -50 $(ls -t $dir 2>/dev/null | head -1) 2>/dev/null || true
    fi
  done

  # Show any /tmp debug logs
  for f in /tmp/omni_*.log; do
    [ -f "$f" ] || continue
    echo ""
    info "── $f ──"
    cat "$f"
    FOUND=1
  done

  if [ "$FOUND" -eq 0 ]; then
    info "No logs found. Run the app first or try 'stream-test' to generate logs."
  fi
}

# ── KILL ─────────────────────────────────────────────────────
cmd_kill() {
  header "Killing Streaming Processes"

  if pkill -f "ffmpeg" 2>/dev/null; then
    pass "Killed FFmpeg processes"
  else
    info "No FFmpeg processes running"
  fi

  if pkill -f "omnistreamstudio" 2>/dev/null; then
    pass "Killed OmniStream Studio processes"
  else
    info "No OmniStream Studio processes running"
  fi
}

# ── DISPATCH ─────────────────────────────────────────────────
case "${1:-help}" in
  check)        cmd_check ;;
  encoders)     cmd_encoders ;;
  vaapi)        cmd_vaapi ;;
  capture)      cmd_capture ;;
  network)      cmd_network ;;
  vite)         cmd_vite ;;
  fix-dev)      cmd_fix_dev ;;
  stream-test)  cmd_stream_test ;;
  logs)         cmd_logs ;;
  kill)         cmd_kill ;;
  *)            show_help ;;
esac

echo ""
