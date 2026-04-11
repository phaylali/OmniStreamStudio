# OmniStream Studio

A lightweight, GPU-accelerated streaming application for Twitch and Kick.

## Features

- **GPU Hardware Encoding** - Uses AMD VCE (or NVENC/QuickSync as fallback) for minimal CPU usage
- **Minimalist Interface** - Clean, distraction-free streaming controls
- **Multi-Platform** - Stream to Twitch or Kick
- **Low Resource Usage** - Optimized for dedicated streaming machines
- **Flexible Ingest Selection** - Choose optimal ingest servers

## Quick Start

1. Download the latest release for your platform
2. Enter your stream key (Twitch/Kick)
3. Select your ingest server
4. Click "Go Live"

## System Requirements

- **OS**: Windows 10+, macOS 11+, Linux (Ubuntu 20.04+)
- **GPU**: AMD (RX 500+), NVIDIA (GTX 10-series+), or Intel (Gen 9+)
- **RAM**: 4GB minimum
- **Network**: Stable 10+ Mbps upload
- **FFmpeg**: Must be installed and in PATH

## Download

[Get the latest release](https://github.com/phaylali/omnistreamstudio/releases)

## Build from Source

```bash
# Install dependencies
bun install

# Run in development
bun run tauri dev

# Build for release
bun run tauri build
```

## Support

- Report bugs via GitHub Issues

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
