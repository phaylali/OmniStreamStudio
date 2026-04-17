# OmniStream Studio - Developer Notes

## Current Architecture (Web Version)

### Tech Stack

- **Frontend**: Konva.js + TypeScript + Vite
- **Encoding**: MediaRecorder API (WebM natively in the browser)
- **Server**: Node.js (WebSocket to ingest WebM blobs)
- **Muxing/Streaming**: FFmpeg subprocess (generates audio, multiplexes to FLV, relays via `tee` muxer)

### Current Pipeline

```
Browser                                    Server                   
┌───────────┐   ┌─────────────┐   ┌────────┐   ┌───────────┐  RTMP   ┌────────┐
│ Konva.js  │──▶│MediaRecorder│──▶│WebSocket│──▶│ FFmpeg   │───────▶│ Twitch │
│  Canvas  │   │   (WebM)    │   │ Binary │   │ (libx264) │───────▶│  Kick  │
└───────────┘   └─────────────┘   └────────┘   └───────────┘        └────────┘
```

## Solved Problems

1. **RTMP Handshake / Twitch Drop**: Twitch abruptly disconnected our pure Node.js RTMP stream because Twitch ingest servers implicitly require an audio track and strict FLV timing. FFmpeg solves this natively by generating a silent `anullsrc` track and handling the FLV muxing precisely.
2. **Kick TLS/Endpoint Errors**: Kick uses `rtmps://` over 443 and requires the stream destination to include the `/app` endpoint before the stream key. This has been corrected in the FFmpeg `tee` string, with `onfail=ignore` added to prevent one failing platform from crashing the whole broadcast.
3. **MediaRecorder Stalling**: `konvaStage.toCanvas()` returns a static, detached canvas. Capturing a stream from it resulted in 1 frame and caused FFmpeg to wait indefinitely (`Starting FFmpeg...` hang). We resolved this by restoring a 30fps `captureInterval` loop that continuously composites the Konva stage onto a persistent offscreen `tempCanvas`.

## Current Problem (To Be Fixed Next Session)

### Problem 1: Frame Duplication / VFR Bitrate Starvation / Visual Lag
**Symptoms**:
- FFmpeg logs indicate it is interpreting the input as `1k fps, 1k tbn` (1000 frames per second).
- FFmpeg outputs `More than 1000 frames duplicated` continuously.
- The stream has visual lag, unstable bitrate, and "ghosting" or traces when moving images.
- Moving elements on the canvas causes high compression artifacts.

**Root Cause**: 
`MediaRecorder` on Chrome/WebM outputs a Variable Frame Rate (VFR) container by default, or the 30fps `tempCanvas.captureStream(30)` has inconsistent timestamps. FFmpeg sees the WebM timestamps, gets confused, and tries to encode at 1000 FPS to compensate. Since we constrained the bitrate to `4500k` (`-b:v 4500k`), FFmpeg violently starves the video quality to encode 1000 frames every second, leaving no bits for motion (causing the "traces").

**Proposed Fix**:
In `server.cjs`, we must strictly force a Constant Frame Rate (CFR) in FFmpeg:
1. Add `-r 30` before `-i pipe:0` to force FFmpeg to read the pipe at 30 fps.
2. Add `-r 30` after `-i pipe:0` to force output at 30 fps.
3. Add `-vsync cfr` or `-fps_mode cfr` to explicitly prevent FFmpeg from attempting to interpolate to 1000 fps.

## File Structure

```
OmniStreamStudio/
├── server.cjs          # WebSocket ingest -> FFmpeg pipeline
├── check_status.ts     # CLI tool to check Twitch/Kick live status
├── web/
│   ├── main.ts     # Frontend with Konva and MediaRecorder
│   ├── index.html
│   └── styles.css
├── .env            # Stream keys
├── package.json
└── README.md
```

## Running

```bash
# Terminal 1 - Start backend
node server.cjs

# Terminal 2 - Start frontend
bun run dev

# Terminal 3 - Check Stream Status
bun check_status.ts
```

Open http://localhost:6969, click GO LIVE.

## Old Tauri Version

The original Tauri-based version used FFmpeg for encoding. See git history for:
- `src-tauri/` - Rust backend
- GPU capture via gpu-screen-recorder
- FFmpeg tee for dual streaming

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