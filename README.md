# OmniStream Studio

A lightweight, GPU-accelerated streaming application for Twitch and Kick with a professional studio interface.

## Features

- **Studio V2 Layout** - Professional 3-column dashboard (Layers, Preview, Settings)
- **Multi-Layer Compositing** - Stack Monitor, Camera, Image, Video, Audio sources
- **GPU Hardware Encoding** - VAAPI (AMD), NVENC (NVIDIA), or Software (x264)
- **Real-time Stats** - Live CPU, GPU, and VRAM usage monitoring
- **Dual Streaming** - Stream to Twitch and Kick simultaneously
- **Preview Pipeline** - MJPEG bridge from Rust to HTML Canvas
- **Low Resource Usage** - Optimized for dedicated streaming machines
- **Window Controls** - Working minimize, maximize, and close buttons

## Quick Start

1. Configure stream keys in `.env`:
   ```env
   TWITCH_KEY=your_key
   KICK_STREAM_URL=rtmps://...
   KICK_KEY=your_key
   ```
2. Run `./run.sh dev`
3. Add layers (Monitor, Camera, etc.) from the left panel
4. Click **GO LIVE**

## System Requirements

- **OS**: Linux (X11), Windows 10+, macOS 11+
- **GPU**: AMD RX 500+, NVIDIA GTX 10-series+, Intel Gen 9+
- **Dependencies**: `ffmpeg`, `bun`, `pactl`

## Build

```bash
bun install
./run.sh dev
# or
bun run tauri build
```

## Recent Fixes

- **Window Controls**: Fixed minimize, maximize, and close buttons with proper Tauri permissions
- **Layers Panel**: Fixed scrolling for long layer lists
- **Video Controls**: Fixed button sizing (play/pause/restart) and layout
- **Aspect Ratio Lock**: Fixed bidirectional sync between width and height
- **FFmpeg Pipeline**: Fixed camera and video source conflict causing preview freeze
- **Performance**: Optimized CPU usage (preview 10fps, ultrafast preset, thread limiting)
- **Layer Reordering**: Now properly restarts stream when live

## Known Issues

- Monitor capture may have lag in some configurations (x11grab limitation)
- Camera and preview may have lag depending on system resources

## License

MIT License

---

&copy; 2026 [Omniversify](https://omniversify.com). All rights reserved.

_Made by Moroccans, for the Omniverse_

[![ReadMeSupportPalestine](https://raw.githubusercontent.com/Safouene1/support-palestine-banner/master/banner-project.svg)](https://donate.unrwa.org/-landing-page/en_EN)