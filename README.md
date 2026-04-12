# OmniStream Studio

A lightweight, GPU-accelerated streaming application for Twitch and Kick. Designed for maximum performance and minimal distraction.

## Features

- **GPU Hardware Encoding** - Uses VAAPI (AMD Linux), NVENC (NVIDIA), or QuickSync (Intel) for near-zero CPU usage.
- **Dynamic Monitor Selection** - Captured specific displays or use a test pattern for debugging.
- **Quality Presets** - Choose between 720p30, 1080p30, and 1080p60 presets with optimized bitrates.
- **Real-time Channel Status** - High-reliability Twitch status tracking via a robust GQL/Bun hybrid sidecar.
- **Adaptive UI** - Dynamic window sizing that automatically fits your content.
- **Multi-Platform** - Stream to Twitch or Kick with optimized ingest server selection.
- **Low Resource Usage** - Optimized for dedicated streaming machines and background operation.

## Quick Start

1. Start the application.
2. Enter your **Stream Key**.
3. Select your **Quality** and **Encoder**.
4. Choose the **Monitor** you want to capture.
5. Click **GO LIVE**.

## System Requirements

- **OS**: Windows 10+, macOS 11+, Linux (CachyOS/Arch/Ubuntu).
- **GPU**: AMD (RX 500+), NVIDIA (GTX 10-series+), or Intel (Gen 9+).
- **RAM**: 4GB minimum.
- **Network**: Stable upload matching your chosen quality (e.g., 6+ Mbps for 1080p60).
- **Dependencies**: `ffmpeg`, `libva-utils` (for VAAPI), and `bun` (for status tracking).

## Build from Source (Bun)

```bash
# Install dependencies
bun install

# Run in development
./run.sh dev

# Build for release
bun run tauri build
```

## Support

- Report bugs via GitHub Issues.
- For VAAPI diagnostics, run `./debug.sh vaapi`.

## License

MIT License

## Support Us

<p align="center">
  <a href="https://ko-fi.com/omniversify">
    <img src="https://raw.githubusercontent.com/phaylali/Omniversify/main/public/images/kofi_logo.svg" width="200" alt="Ko-Fi" />
  </a>
</p>

<p align="center">
  <strong>Keep us going</strong>
</p>

---

&copy; 2026 [Omniversify](https://omniversify.com). All rights reserved.

_Made by Moroccans, for the Omniverse_

[![ReadMeSupportPalestine](https://raw.githubusercontent.com/Safouene1/support-palestine-banner/master/banner-project.svg)](https://donate.unrwa.org/-landing-page/en_EN)
