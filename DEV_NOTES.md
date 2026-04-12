# OmniStream Studio - Developer Notes

## Project Overview

A lightweight GPU-accelerated streaming encoder designed for minimal resource consumption. Targets users who want dedicated streaming without the overhead of full broadcast software.

## Architecture

### Tech Stack

- **Framework**: Tauri 2.x (Rust backend + WebView2 frontend)
- **UI**: Vanilla TypeScript + CSS (no heavy frameworks)
- **Encoder**: FFmpeg with hardware acceleration
- **Status Sidecar**: Bun-based scraper for high-reliability Twitch status tracking
- **Streaming**: RTMP protocol via FFmpeg

### Core Design Principles

1. **GPU-First Encoding** - CPU fallback only when GPU unavailable
2. **Zero-Bloat** - No scene compositing, no filters, no plugins
3. **Robust Tracking** - Multi-layer status check (Rust GQL + Bun Scraper fallback)
4. **Adaptive UI** - Content-driven window sizing

## UI/UX Specification

### Window Configuration

- **Size**: Dynamic height (400px width), resizable programmatically to fit content
- **Position**: Center on primary monitor
- **Style**: Frameless with custom title bar
- **Theme**: Dark mode only (#1a1a1a background)

### Components

| Component | Features |
|-----------|----------|
| Platform dropdown | Twitch/Kick switcher |
| Quality dropdown | 720p30, 1080p30, 1080p60 presets |
| Monitor selector | Dynamic `xrandr` detection with resolution/offset support |
| Encoder selector | Priority-based hardware detection (VAAPI, NVENC, QSV, SW) |
| Live Indicator | Multi-source real-time status tracker |

## Video Encoding

### Quality Presets & Bitrates

| Preset | Target Res | FPS | Bitrate (CBR) |
|--------|------------|-----|---------------|
| 720p30 | 1280x720 | 30 | 3000k |
| 1080p30| 1920x1080 | 30 | 4500k |
| 1080p60| 1920x1080 | 60 | 6000k |

### Encoder Priority (Linux — CachyOS / Arch)

1. **VAAPI** (`h264_vaapi`) — Primary for AMD/Intel on Linux. Uses `/dev/dri/renderD128`.
2. **NVIDIA NVENC** (`h264_nvenc`) — For NVIDIA GPUs.
3. **Software** (`libx264`) — CPU fallback with `ultrafast` preset.

### Filter Chain Construction

The filter chain is constructed dynamically based on the source resolution (detected via `xrandr`) and the target quality.

- **VAAPI Path**: `scale=WIDTH:HEIGHT:flags=fast_bilinear,format=nv12,hwupload`
- **Software Path**: `scale=WIDTH:HEIGHT:flags=fast_bilinear`

## Capture Pipeline (Linux)

Capture is handled via `x11grab` with precise geometry tracking per monitor:
- **Input**: `:0.0+X,Y` where X and Y are offsets detected from `xrandr --listmonitors`.
- **Scaling**: Handled by FFmpeg filters to match the selected Quality preset.

## Twitch Status Tracking (Tiered System)

Twitch's API/GQL is heavily protected. The app uses a tiered logic:

1. **Rust GQL**: Mimics a browser request to `gql.twitch.tv/gql` with a unique `Client-ID` and `X-Device-Id`.
2. **Bun Scraper Fallback**: Runs `scripts/status.ts` using Bun. It fetches the channel page and searches for the `"isLive":true` / `"type":"live"` markers in the initial state JSON, bypassing GQL rejects.

## Build & Debug

- **Dev Mode**: `./run.sh dev` (Starts Vite + Tauri)
- **Deep Diagnostics**: `./debug.sh vaapi` (Tests rendering nodes and vainfo)
- **Encoder Test**: `./debug.sh encoders` (Verifies FFmpeg capability)

## Data Storage

- **.env**: Used for build-time injection of `TWITCH_USERNAME` and default keys.
- **Tauri State**: Manages the life cycle of the FFmpeg sidecar process to prevent zombies.

## Known Gotchas

- **Resolution 400x320**: Window is no longer fixed; `syncWindowSize` calculates `scrollHeight` on every UI change.
- **VAAPI Device**: Currently defaults to `renderD128`.
- **X11 Exclusive**: Monitor detection is currently optimized for X11; Wayland support requires PipeWire implementation.旋