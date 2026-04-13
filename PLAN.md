# OmniStream Studio V2: The Command Center

This plan transforms the current sidepanel application into a full-featured streaming dashboard with multi-source management and a live preview.

## User Review Required

> [!IMPORTANT]
> **Performance Impact**: Adding a live preview and multiple audio/video filters in FFmpeg will increase CPU/GPU usage. I will include a "Low Resource Mode" to disable the preview during high-intensity gaming.
> **Window Behavior**: The app will transition from a fixed-width sidepanel to a resizable window to accommodate the new multi-column layout.

## Proposed Changes

### 1. UI & Layout Overhaul

#### [MODIFY] [index.html](file:///home/phaylali/Documents/Apps/OmniStreamStudio/index.html)

- Implement a 3-column layout:
  - **Left**: Multi-Stream Chat (Placeholder for now).
  - **Center**: Main Canvas Preview with a "Toggle Preview" button.
  - **Right**: Enhanced Settings Sidebar.
- Add new groups for Audio (In/Out + Volume) and Video Devices.

#### [MODIFY] [styles.css](file:///home/phaylali/Documents/Apps/OmniStreamStudio/src/styles.css)

- Redesign the app using `display: grid` or `flex` for the multi-panel view.
- Add styling for the preview area, volume sliders, and the new "Studio" look.

### 2. Device Management & Control

#### [MODIFY] [lib.rs](file:///home/phaylali/Documents/Apps/OmniStreamStudio/src-tauri/src/lib.rs)

- **New Commands**:
  - `get_audio_devices`: Lists PulseAudio/PipeWire sources and sinks.
  - `get_video_devices`: Lists `/dev/video*` nodes.
- **FFmpeg Command Factory**:
  - Support multiple audio inputs via `amix` filter.
  - Implement `overlay` filters for the background image, monitor capture, and camera feed.
  - Handle user-defined coordinates and sizes for the camera overlay.

#### [MODIFY] [main.ts](file:///home/phaylali/Documents/Apps/OmniStreamStudio/src/main.ts)

- Update state to manage audio/video device selections and volume levels.
- Implement the "Preview" toggle logic.
- Add polling/event listeners for new dropdowns.

### 3. Window Configuration

#### [MODIFY] [tauri.conf.json](file:///home/phaylali/Documents/Apps/OmniStreamStudio/src-tauri/tauri.conf.json)

- Set `resizable: true`.
- Adjust initial dimensions to a "Studio" layout (e.g., 1200x800).

## Open Questions

1. **Preview Method**: Do you want the preview to be a low-fps "snapshot" (very light) or a smooth video stream (heavier)?
2. **Audio Mixing**: Should the "Output Audio" capture your system sound (what you hear) and mix it with the mic?
3. **Chat Integration**: For the chat perfection you mentioned, do you want me to create the container for it now, or wait until you share the existing code?

## Verification Plan

### Manual Verification

- **Device Detection**: Verify that your USB mic and headset appear in the new dropdowns.
- **Volume Control**: Test if adjusting the slider actually changes the output volume in the stream.
- **Layout Test**: Resize the window and ensure the preview and sidebars scale correctly.
- **Overlay Test**: Verify the camera appears at the specified coordinates on top of the monitor.
  旋
