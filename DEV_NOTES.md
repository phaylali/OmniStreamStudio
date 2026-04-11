# OmniStream Studio - Developer Notes

## Project Overview

A lightweight GPU-accelerated streaming encoder designed for minimal resource consumption. Targets users who want dedicated streaming without the overhead of full broadcast software.

## Architecture

### Tech Stack

- **Framework**: Tauri 2.x (Rust backend + WebView2 frontend)
- **UI**: Vanilla TypeScript + CSS (no heavy frameworks)
- **Encoder**: FFmpeg with hardware acceleration
- **Streaming**: RTMP protocol via FFmpeg

### Core Design Principles

1. **GPU-First Encoding** - CPU fallback only when GPU unavailable
2. **Zero-Bloat** - No scene compositing, no filters, no plugins
3. **Simple State Machine** - Idle → Preparing → Live → Ending

## UI/UX Specification

### Window Configuration

- **Size**: 400x320 pixels (fixed, non-resizable)
- **Position**: Center on primary monitor
- **Style**: Frameless with custom title bar
- **Theme**: Dark mode only (#1a1a1a background)

### Layout Structure

```
┌─────────────────────────────────┐
│ [─][×]          OmniStream      │  ← Title bar (28px)
├─────────────────────────────────┤
│                                 │
│  Platform: [Twitch    ▼]       │  ← Platform selector
│                                 │
│  Stream Key: [••••••••••••]   │  ← Password input
│                                 │
│  Ingest: [auto (recommended) ▼] │  ← Ingest dropdown
│                                 │
│     ┌───────────────────┐       │
│     │    GO LIVE       │       │  ← Action button (primary)
│     └───────────────────┘       │
│                                 │
│  [●] Live - 00:00:00          │  ← Status bar
└─────────────────────────────────┘
```

### Components

| Component | States | Behavior |
|-----------|--------|----------|
| Platform dropdown | default, hover, open | Toggle between Twitch/Kick |
| Stream key input | empty, filled, error, masked | Show/hide toggle |
| Ingest dropdown | default, hover, loading, populated | Dynamic based on platform |
| Go Live button | idle, preparing, live, error | State machine driven |
| Status indicator | idle (gray), live (green pulse), error (red) | Timer when live |

### Ingest Lists

**Twitch Ingests** (auto-populated from API):
- auto (recommended) - rtmp.live.justin.tv
- Frankfurt - rtmps.fra02.contribute.live
- Amsterdam - rtmps.ams03.contribute.live
- London - rtmps.lhr02.contribute.live
- Paris - rtmps.cdg01.contribute.live

**Kick Ingests**:
- rtmp://live-kick.edge.kick.com

## Video Encoding

### Encoder Priority (in order)

1. **AMD VCE** (Primary - user's system)
   - Codec: h264_amf (AMD Media Foundation)
   - Preset: low-latency-quality
   - Bitrate: 6000 kbps (local), 4500 kbps (remote)
   - Keyframe interval: 2s
   - B-frames: 0 (latency optimization)
   - Profile: high

2. **NVIDIA NVENC** (Secondary)
   - Codec: h264_nvenc
   - Preset: p4 (lowest latency)
   - Similar settings

3. **Intel QuickSync** (Tertiary)
   - Codec: h264_qsv
   - Similar settings

4. **Software fallback** (Last resort)
   - Codec: libx264
   - Preset: veryfast
   - Higher CPU usage expected

### Audio Encoding

- Codec: aac
- Bitrate: 192 kbps
- Sample rate: 48kHz
- Channels: Stereo

## Streaming Protocol

### RTMP Configuration

- Protocol: RTMPS (TLS)
- Container: FLV
- Video codec: H.264 (High profile)
- Audio codec: AAC-LC
- Metadata: Stream key appended to ingest URL

### URL Construction

```
rtmps://[ingest_host]/app/[stream_key]
```

## Data Storage

- **Config location**: OS app data directory
- **Format**: JSON
- **Contents**: Platform, last used ingest (not stream key)
- **Stream key**: Never persisted (memory only)

## State Machine

```
┌─────────┐     start      ┌────────────┐
│  IDLE   │ ──────────────▶│ PREPARING │
└─────────┘                 └────────────┘
      ▲                          │
      │            timeout (3s)  │
      │                          ▼
   stop    ┌─────────┐    ┌───────────┐
◀─────────│ ENDING  │◀───│    LIVE   │
          └─────────┘    └───────────┘
```

## API Endpoints

### Twitch API

- **Ingest List**: `https://ingest.twitch.tv/ingests`
- **GQL (optional)**: Stream status validation

### Kick API

- **Ingest**: `rtmp://live-kick.edge.kick.com` (static)

## Security Considerations

- Stream key stored only in memory, cleared on exit
- No analytics or telemetry
- No network calls except streaming/ingest
- HTTPS-only for all API calls

## Build Targets

| Platform | Binary | Command |
|----------|--------|---------|
| Windows | .exe | `bun run tauri build` |
| macOS | .app | `bun run tauri build` |
| Linux | .AppImage | `bun run tauri build` |

## Performance Targets

- **Idle RAM**: < 80MB
- **Live RAM**: < 150MB
- **GPU usage**: < 15% (NVENC)
- **CPU usage**: < 5% (with GPU encoding)
- **Startup time**: < 2 seconds
- **Latency**: Sub-1 second glass-to-glass

## Future Considerations

- Desktop capture (screen capture)
- Webcam overlay
- Basic audio mixing
- Stream health indicators
- Recording to local file

## Contributing

1. Fork the repository
2. Create feature branch
3. Pull request against main
4. CI will build and test

## Resources

- FFmpeg encoding docs: https://ffmpeg.org/ffmpeg-codecs.html
- NVENC setup: https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix
- Tauri 2.x: https://v2.tauri.app/