# OmniStream Studio - Developer Notes

## Project Overview

Professional GPU-accelerated streaming encoder with multi-layer compositing for Twitch and Kick.

## Architecture

### Tech Stack

- **Framework**: Tauri 2.x (Rust backend + WebView2)
- **UI**: Vanilla TypeScript + CSS
- **Encoder**: FFmpeg (VAAPI/NVENC/QSV/x264)
- **Streaming**: RTMP via FFmpeg tee muxer

### Core Components

1. **Frontend (`main.ts`)** - UI, layer management, Tauri IPC
2. **Backend (`lib.rs`)** - FFmpeg process, device enumeration, stats
3. **Status Script (`status.ts`)** - Bun-based channel status checker

## Layer System

| Type | Capture Method | Features |
|------|---------------|----------|
| Monitor | x11grab | Geometry detection, X/Y offset |
| Camera | video4linux2 | V4L2 devices |
| Image | file input | Looping, scale |
| Video | file input | Loop, volume control |
| Mic | pulseaudio | Device selection + volume |
| Music | file input | Auto-loop, volume |
| Placeholder | lavfi color | Color block |

## Video Pipeline

### Filter Graph Construction

```
lavfi color=black (background)
    ↓ overlay ↓
x11grab (monitor) → scale → overlay → ...
    ↓
video4linux2 (camera) → scale → overlay → ...
    ↓
[inputs] → amix (audio mixing)
    ↓
VAAPI hwupload (if GPU encoding)
    ↓
FFmpeg encoding → RTMP output
```

### Quality Presets

| Preset | Resolution | FPS | Bitrate |
|--------|-----------|-----|--------|
| 720p30 | 1280x720 | 30 | 3000k |
| 1080p30 | 1920x1080 | 30 | 4500k |
| 1080p60 | 1920x1080 | 60 | 6000k |

### Encoder Priority

1. **VAAPI** (`h264_vaapi`) - AMD/Intel GPUs
2. **NVENC** (`h264_nvenc`) - NVIDIA GPUs
3. **Software** (`libx264`) - CPU fallback

## Preview Pipeline

- FFmpeg output via `image2pipe` (MJPEG)
- Raw stdout captured in Rust
- JPEG frames extracted and base64 encoded
- Emitted via Tauri events to frontend Canvas

## System Stats

- **CPU**: `ps` command on app/ffmpeg PIDs
- **GPU**: `/sys/class/drm/card*/device/hwmon/*/gpu_busy_percent`
- **VRAM**: `/sys/class/drm/card*/device/mem_info_vram_used`

## Known Limitations

1. **Kick Streaming**: Dual platform muxing may have issues
2. **Monitor Geometry**: Offset monitors require precise xrandr parsing
3. **Wayland**: PipeWire capture not yet implemented

## Commands

```bash
./run.sh dev      # Development mode
./debug.sh vaapi  # VAAPI diagnostics
```

## Data Storage

- `.env` - Stream keys and credentials
- `tauri.conf.json` - App configuration

---

&copy; 2026 [Omniversify](https://omniversify.com). All rights reserved.

_Made by Moroccans, for the Omniverse_