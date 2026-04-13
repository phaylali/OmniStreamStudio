# OmniStream Studio V2 Overhaul Plan

## Current Status: 🟠 INTERMEDIATE STAGE

The application has been transformed from a single-column sidepanel into a professional, resizable 3-column Studio V2 dashboard. While the architectural foundation is solid, native hardware capture on Linux (X11/Wayland) remains an active challenge.

---

## ✅ Completed in V2.0

- [x] **Studio Layout**: Resizable 3-column grid (Chat, Preview, Settings).
- [x] **Glassmorphism UI**: High-end dark theme with glass background effects.
- [x] **Multi-Platform logic**: Unified FFmpeg pipeline to stream to Twitch and Kick simultaneously.
- [x] **Audio Routing**: Backend enumeration of Mic/System audio with volume mixing.
- [x] **Camera Overlays**: Support for camera positioning and scaling on the canvas.
- [x] **Real-time Preview Pipe**: High-performance MJPEG bridge from Rust to TS Canvas.
- [x] **Virtual Sources**: "No Monitor" Test Pattern fallback using FFmpeg `lavfi`.
- [ ] **Native UI Controls**: Fixed minimize, close, and dragging using Tauri-native APIs (`startDragging`).

---

## ⛔ Current Blockers (Active Issues)

1. **Real Monitor Capture**:
   - Symptoms: Choosing a real monitor results in a black screen or "pauses" the preview.
   - Analysis: FFmpeg `x11grab` is struggling to bind to the correct X11 display ID even with dynamic `:DISPLAY` detection. Likely a compositor permissions issue or Wayland incompatibility.
2. **Preview Scalability**:
   - The fullscreen preview (⛶) works via the Browser API but its visual fidelity on real hardware (once capture is fixed) needs validation.
3. **Chat Panel**:
   - Currently a UI placeholder; requires integration of the "Perfected Multistream Chat" logic.

---

## 🛠️ Next Implementation Phase

### 1. Advanced Linux Capture

- Investigate **PipeWire** integration for backend capture to support Wayland users.
- Add additional FFmpeg fallbacks for `kmsgrab` and `fbdev`.
- Provide user logs in the UI for FFmpeg capture errors.

### 2. Chat Integration

- Import the user's multi-stream chat window code.
- Implement the "Chat Sidebar" collapsing/expanding logic with live messages.

### 3. Audio Polish

- Add visual volume meters (peak meters) next to sliders.
- Implement "Mute" toggles for input/output.

---

## 📋 Dev Notes

- **Env Requirement**: Ensure `KICK_USERNAME` and `KICK_STREAM_URL` are set.
- **Resource Mode**: Keep "Preview OFF" by default to ensure maximum FPS in games until capture is optimized.

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
