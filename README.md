# OmniStream Studio

A web-based streaming studio for Twitch and Kick with real-time canvas compositing.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Browser                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────┐ │
│  │  Konva.js │────▶│MediaRecorder│────▶│ WebSocket│ │
│  │  Canvas  │     │   (WebM)   │     │  Client │ │
│  └─────────────┘     └─────────────┘     └─────────┘ │
└──────────────────────────────────────────┬──────┘
                                              │
                                              ▼
                                    omnistream.json
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Node.js Server (port 6970)           │
│  ┌─────────────┐     ┌─────────────────────┐   │
│  │ WebSocket  │────▶│   FFmpeg Pipeline  │───▶│ Twitch  │
│  │  Server   │     │ (RTMP relay)      │   │ Kick   │
│  └─────────────┘     └─────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Features

- **Scene System**: Multiple scenes with instant switching
- **Layer Types**: Images, Text, HTML overlays, Media, Widgets
- **Canvas Compositing**: Drag, resize, rotate layers with Konva.js
- **Audio Support**: Microphone and desktop audio capture
- **JSON Storage**: Human-readable data file (omnistream.json)
- **Dual Streaming**: Stream to Twitch and Kick simultaneously

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
5. Add layers (images, text, widgets)
6. Click **GO LIVE**

## Running

```bash
# Terminal 1 - Start backend
node server.cjs

# Terminal 2 - Start frontend
bun run dev
```

The JSON data file (`omnistream.json`) is created automatically and stores:
- Scenes and their layers (position, size, rotation)
- Text configurations
- Image sources
- Widget settings
- Platform preferences

## Tech Stack

- **UI**: Konva.js + TypeScript + Vite
- **Encoding**: MediaRecorder (WebM)
- **Server**: Node.js WebSocket + FFmpeg
- **Storage**: JSON file

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