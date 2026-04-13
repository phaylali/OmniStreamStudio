# OmniStream Studio - Roadmap

## Current Status: 🟢 ACTIVE

V2 Studio with multi-layer compositing is operational. GPU encoding and dual streaming are working (Twitch verified, Kick in progress).

---

## Completed

- [x] Studio V2 3-column layout
- [x] Multi-layer system (Monitor, Camera, Image, Video, Audio)
- [x] GPU encoding (VAAPI, NVENC, CPU fallback)
- [x] Real-time stats overlay
- [x] Preview pipeline (MJPEG)
- [x] Dual platform UI

---

## In Progress

1. **Kick Streaming Fix** - Dual platform output issues
2. **Monitor Geometry** - Offset screen resolution parsing

---

## Future Enhancements

| Priority | Feature |
|----------|---------|
| High | PipeWire capture (Wayland) |
| High | Scene presets (save/load) |
| Medium | Chat integration |
| Medium | Audio filters |
| Low | Recording to file |
| Low | WebView layer |

---

## Environment

```env
TWITCH_KEY=
TWITCH_USERNAME=
KICK_STREAM_URL=
KICK_KEY=
KICK_USERNAME=
```

---

&copy; 2026 [Omniversify](https://omniversify.com)