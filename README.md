# OmniStream Studio

A web-based streaming studio for Twitch and Kick with GPU-accelerated encoding.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Browser                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────┐ │
│  │  Konva.js │────▶│MediaRecorder│────▶│ WebSocket│ │
│  │  Canvas  │     │   (WebM)   │     │  Client │ │
│  └─────────────┘     └─────────────┘     └─────────┘ │
└──────────────────────────────────────────┬──────┘
                                             │ ws://localhost:6970
┌──────────────────────────────────────────────┴──────┐
│                   Node.js Server                   │
│  ┌─────────────┐     ┌─────────────────────┐   │
│  │ WebSocket  │────▶│   FFmpeg Pipeline  │───▶│ Twitch  │
│  │  Server  │     │ (Muxer + Audio)   │   │ Kick   │
│  └─────────────┘     └─────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Features

- **Studio V2 Layout** - Professional 3-column dashboard (Layers, Preview, Settings)
- **Multi-Layer Compositing** - Image, Text, HTML overlays
- **Browser Encoding** - MediaRecorder API (native WebM encoding)
- **Dual Streaming** - Twitch and Kick simultaneously via FFmpeg `tee` muxer
- **Resilient Pipeline** - Auto-generating silent audio track to comply with Twitch ingest requirements

## Quick Start

1. Configure stream keys in `.env`:
   ```env
   TWITCH_KEY=live_xxxxxxxxxxxxxxxx
   KICK_STREAM_URL=rtmps://fa723fc1b171.global-contribute.live-video.net/
   KICK_KEY=sk_us-west-2_xxxxxxxxxxxxxxxx
   ```
2. Start server: `node server.cjs`
3. Start frontend: `bun run dev`
4. Open http://localhost:6969
5. Click **GO LIVE**

## Running

```bash
# Terminal 1 - Start backend
node server.cjs

# Terminal 2 - Start frontend
bun run dev
```

## Tech Stack

- **UI**: Konva.js + TypeScript
- **Encoding**: MediaRecorder (WebM)
- **Server**: Node.js WebSocket + FFmpeg
- **Streaming**: FFmpeg `tee` multiplexer

## Known Issues

- **High Framerate / Visual Traces**: FFmpeg currently misinterprets the variable framerate from `MediaRecorder` as 1000 FPS (`1k fps`), causing frame duplication, bitrate starvation, and visual tearing/lag. This will be fixed in the next session by enforcing strict framerates (`-r 30`).
See `DEV_NOTES.md` for detailed progression and technical debt.

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