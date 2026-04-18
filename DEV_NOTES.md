# OmniStream Studio - Developer Notes

## Current Architecture (Web Version)

### Tech Stack

- **Frontend**: Konva.js + TypeScript + Vite
- **Storage**: JSON file (omnistream.json)
- **Encoding**: MediaRecorder API (WebM natively in browser)
- **Server**: Node.js WebSocket server (port 6970)
- **Streaming**: FFmpeg subprocess (relays RTMP to Twitch/Kick)

### Server Ports

- `6970` - WebSocket server (ingest + DB sync)
- `6971` - HTTP server (proxy + file serving)
- `6972` - Events server (SSE for overlays)

### Current Pipeline

```
Browser                                    Server                   
┌───────────┐   ┌─────────────┐   ┌────────┐   ┌───────────┐  RTMP   ┌────────┐
│ Konva.js  │──▶│MediaRecorder│──▶│WebSocket│──▶│ FFmpeg   │───────▶│ Twitch │
│  Canvas  │   │   (WebM)    │   │ Binary │   │ (libx264) │───────▶│  Kick  │
└───────────┘   └─────────────┘   └────────┘   └───────────┘        └────────┘
        │
        ▼
   omnistream.json
```

## Data Storage

All data is stored in `omnistream.json`:

```json
{
  "scenes": [
    {
      "id": "default",
      "name": "Main",
      "layers": [
        {
          "id": "1234567890",
          "type": "image",
          "active": true,
          "x": 960,
          "y": 540,
          "width": 400,
          "height": 300,
          "scaleX": 1,
          "scaleY": 1,
          "rotation": 0,
          "imageConfig": { "opacity": 1, "scaleX": 1, "scaleY": 1 },
          "imageSrc": "/path/to/image.png"
        },
        {
          "id": "1234567891",
          "type": "text",
          "active": true,
          "textConfig": { "text": "Hello", "fontSize": 36, "color": "#ffffff", "fontFamily": "Inter" }
        }
      ],
      "updated_at": 1776486198510
    }
  ],
  "settings": {
    "platforms": ["twitch"],
    "resolution": "1080p30",
    "twitchIngest": "",
    "kickIngest": ""
  }
}
```

## File Structure

```
OmniStreamStudio/
├── server.cjs          # Node.js WebSocket + FFmpeg server
├── omnistream.json    # JSON data storage
├── check_status.ts    # CLI tool to check Twitch/Kick live status
├── web/
│   ├── main.ts        # Frontend with Konva and MediaRecorder
│   ├── index.html
│   └── styles.css
├── .env               # Stream keys
├── package.json
└── README.md
```

## Running

```bash
# Terminal 1 - Start backend
node server.cjs

# Terminal 2 - Start frontend
bun run dev

# Terminal 3 - Check Stream Status (optional)
bun check_status.ts
```

Open http://localhost:6969

## Features Implemented

- **Scenes System**: Add, delete, switch between scenes
- **Layers**: Image, Text, HTML, Media, Widgets (clock, countdown)
- **Compositing**: Konva.js canvas with drag/resize/rotate
- **Audio**: Microphone and desktop capture support
- **Storage**: JSON file (human-readable, easy to edit)
- **Dual Streaming**: Twitch and Kick via FFmpeg

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