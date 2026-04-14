import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

const appWindow = getCurrentWindow();

// --- Types ---
type LayerType = 'monitor' | 'camera' | 'image' | 'video' | 'mic' | 'music' | 'placeholder';

interface Layer {
  id: string;
  type: LayerType;
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  source_id?: string;
  path?: string;
  color?: string;
  volume?: number;
  loop_?: boolean;
  audio_input?: string;
  playing?: boolean;
  aspectLocked?: boolean;
}

// --- State ---
const state = {
  isLive: false,
  platforms: { twitch: false, kick: false },
  preview: false,
  startTime: 0,
  timerInterval: null as any,
  statsInterval: null as any,
  layers: [] as Layer[],
  availableMonitors: [] as any[],
  availableAudio: [] as any[],
  availableCameras: [] as any[],
};

// --- DOM Elements ---
const actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const timerEl = document.getElementById("timer") as HTMLElement;
const liveIndicator = document.getElementById("live-indicator") as HTMLElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;

const twitchBtn = document.getElementById("toggle-twitch") as HTMLButtonElement;
const kickBtn = document.getElementById("toggle-kick") as HTMLButtonElement;
const twitchIngestGroup = document.getElementById("twitch-ingest-group") as HTMLElement;
const ingestSelect = document.getElementById("ingest") as HTMLSelectElement;

const qualitySelect = document.getElementById("quality") as HTMLSelectElement;
const encoderSelect = document.getElementById("encoder") as HTMLSelectElement;

const layersList = document.getElementById("layers-list") as HTMLElement;
const addLayerBtn = document.getElementById("add-layer-btn") as HTMLButtonElement;
const addLayerMenu = document.getElementById("add-layer-menu") as HTMLElement;

const statCpu = document.getElementById("stat-cpu") as HTMLElement;
const statGpu = document.getElementById("stat-gpu") as HTMLElement;
const statVram = document.getElementById("stat-vram") as HTMLElement;

const togglePreviewBtn = document.getElementById("toggle-preview") as HTMLButtonElement;
const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const previewOverlay = document.getElementById("preview-overlay") as HTMLElement;
const previewStatus = document.getElementById("preview-status") as HTMLElement;
const fullscreenPreviewBtn = document.getElementById("fullscreen-preview") as HTMLButtonElement;
const titleBar = document.querySelector(".title-bar") as HTMLElement;
const maximizeBtn = document.getElementById("maximize-btn") as HTMLButtonElement;

// --- Window Controls ---
function setupWindowControls() {
  const minimizeBtn = document.getElementById("minimize-btn");
  const closeBtn = document.getElementById("close-btn");

  if (titleBar) {
    titleBar.addEventListener("mousedown", async (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest(".window-controls")) return;
      await appWindow.startDragging();
    });
  }

  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", () => appWindow.minimize());
  }
  
  if (maximizeBtn) {
    maximizeBtn.addEventListener("click", async () => {
      const isMaximized = await appWindow.isMaximized();
      if (isMaximized) {
        appWindow.unmaximize();
      } else {
        appWindow.maximize();
      }
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (state.isLive) invoke("stop_stream");
      appWindow.close();
    });
  }

  if (fullscreenPreviewBtn) {
    fullscreenPreviewBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        previewCanvas.requestFullscreen().catch(e => console.error(e));
      } else {
        document.exitFullscreen();
      }
    });
  }
}

// --- Init ---
async function init() {
  console.log("OmniStream Studio V2 initializing robust backend multi-layer engine...");
  setupWindowControls();

  const testWebRtcBtn = document.getElementById("test-webrtc-btn") as HTMLButtonElement;
  if(testWebRtcBtn) testWebRtcBtn.style.display = 'none';

  try {
    await Promise.all([
      loadMonitors(),
      loadCameras(),
      loadAudioDevices(),
      loadEncoders(),
      loadIngests()
    ]);
  } catch (err) {
    console.error("Critical component load error:", err);
  }

  updatePlatformUI();
  updateStatus("Ready");
  startStatusPolling();
  updateCanvasPlaceholder();

  qualitySelect.addEventListener("change", updateCanvasPlaceholder);

  document.addEventListener("click", (e) => {
    if (!addLayerMenu.contains(e.target as Node) && e.target !== addLayerBtn) {
      addLayerMenu.classList.add("hidden");
    }
  });

  listen<string>("preview-frame", (event) => {
    if (!state.preview) return;
    const img = new Image();
    img.onload = () => {
      const ctx = previewCanvas.getContext("2d");
      if (ctx) {
        previewCanvas.width = img.width;
        previewCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      }
    };
    img.src = `data:image/jpeg;base64,${event.payload}`;
  });
}

function updateCanvasPlaceholder() {
  const q = qualitySelect.value;
  const src = q.includes("720") ? "/placeholder_720p.jpg" : "/placeholder_1080p.jpg";
  const img = new Image();
  img.onload = () => {
     const ctx = previewCanvas.getContext("2d");
     if (ctx) {
       previewCanvas.width = img.width;
       previewCanvas.height = img.height;
       ctx.drawImage(img, 0, 0);
     }
  };
  img.src = src;
}

// --- Data Loading ---
async function loadIngests() {
  try {
    const response = await fetch("https://ingest.twitch.tv/ingests");
    const data = await response.json();
    ingestSelect.innerHTML = data.ingests
      .map((i: any) => `<option value="${i.url_template.replace("{stream_key}", "")}">${i.name}</option>`)
      .join("");
  } catch (e) {
    ingestSelect.innerHTML = '<option value="rtmp://live.twitch.tv/app/">Primary (Fallback)</option>';
  }
}

async function loadMonitors() {
  state.availableMonitors = await invoke<any[]>("get_monitors");
}

async function loadCameras() {
  state.availableCameras = await invoke<any[]>("get_video_devices");
}

async function loadAudioDevices() {
  state.availableAudio = await invoke<any[]>("get_audio_devices");
}

async function loadEncoders() {
  const encoders = await invoke<any[]>("get_available_encoders");
  encoderSelect.innerHTML = encoders.map(e => `<option value="${e.id}">${e.name}</option>`).join("");
  const firstGpu = encoders.find(e => e.type_ === "gpu");
  if (firstGpu) encoderSelect.value = firstGpu.id;
}

// --- Platform Handlers ---
function updatePlatformUI() {
  twitchBtn.classList.toggle("active", state.platforms.twitch);
  kickBtn.classList.toggle("active", state.platforms.kick);
  twitchIngestGroup.classList.toggle("hidden", !state.platforms.twitch);
  
  const anyActive = state.platforms.twitch || state.platforms.kick;
  actionBtn.disabled = !anyActive;
}

twitchBtn.addEventListener("click", () => { state.platforms.twitch = !state.platforms.twitch; updatePlatformUI(); });
kickBtn.addEventListener("click", () => { state.platforms.kick = !state.platforms.kick; updatePlatformUI(); });

// --- Layers Logic ---
addLayerBtn.addEventListener("click", () => addLayerMenu.classList.toggle("hidden"));

addLayerMenu.addEventListener("click", (e) => {
  if (e.target instanceof HTMLButtonElement) {
    const type = e.target.getAttribute("data-type") as LayerType;
    if (type) addLayer(type);
    addLayerMenu.classList.add("hidden");
  }
});

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function addLayer(type: LayerType) {
  const newLayer: Layer = {
    id: generateId(),
    type,
    active: true,
    x: 0,
    y: 0,
    w: type === 'camera' ? 640 : 1920,
    h: type === 'camera' ? 480 : 1080,
    loop_: type === 'video' || type === 'music',
    playing: type === 'video' || type === 'music',
  };

  if (type === 'monitor' && state.availableMonitors.length > 0) {
    const rMonitor = state.availableMonitors[0];
    newLayer.source_id = rMonitor?.id;
    newLayer.volume = 1.0;
    newLayer.audio_input = "none";
    if (rMonitor?.resolution) {
        const [rw, rh] = rMonitor.resolution.split('x').map(Number);
        newLayer.w = rw || 1920; newLayer.h = rh || 1080;
    }
  } else if (type === 'camera' && state.availableCameras.length > 0) {
    newLayer.source_id = state.availableCameras[0].id;
    newLayer.volume = 1.0;
  } else if (type === 'image' || type === 'video' || type === 'music') {
    newLayer.path = "/absolute/path/to/media";
    if (type !== 'image') newLayer.volume = 1.0;
  } else if (type === 'mic' && state.availableAudio.length > 0) {
    newLayer.source_id = state.availableAudio[0].id;
    newLayer.volume = 1.0;
  } else if (type === 'placeholder') {
    newLayer.color = "red";
  }

  state.layers.push(newLayer);
  renderLayers();
  if (state.preview) restartPreview();
}

function removeLayer(id: string) {
  state.layers = state.layers.filter(l => l.id !== id);
  renderLayers();
  if (state.preview) restartPreview();
}

function moveLayer(index: number, up: boolean) {
  if (up && index > 0) {
    [state.layers[index - 1], state.layers[index]] = [state.layers[index], state.layers[index - 1]];
  } else if (!up && index < state.layers.length - 1) {
    [state.layers[index + 1], state.layers[index]] = [state.layers[index], state.layers[index + 1]];
  }
  renderLayers();
  if (state.isLive) {
    restartStream();
  } else if (state.preview) {
    restartPreview();
  }
}

function updateLayer(id: string, prop: keyof Layer, value: any) {
  const layer = state.layers.find(l => l.id === id);
  if (layer) {
    (layer as any)[prop] = (prop === 'volume' || prop === 'x' || prop === 'y' || prop === 'w' || prop === 'h') ? parseFloat(value) : value;
  }
}

function createSourceOptions(devices: any[], selected: string | undefined): string {
  return devices.map(d => `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${d.name}</option>`).join("");
}

function renderLayers() {
  layersList.innerHTML = "";
  
  state.layers.forEach((layer, index) => {
    const card = document.createElement("div");
    card.className = `layer-card ${!layer.active ? "inactive" : ""}`;
    card.dataset.id = layer.id;

    let propsHtml = "";
    if (layer.type === "monitor") {
      propsHtml += `<div class="layer-prop full">
        <label>Source</label>
        <select class="prop-input" data-prop="source_id">${createSourceOptions(state.availableMonitors, layer.source_id)}</select></div>
        <div class="layer-prop full audio-input-row">
          <label>Audio Input</label>
          <select class="prop-input" data-prop="audio_input">
            <option value="none" ${layer.audio_input === "none" ? "selected" : ""}>None</option>
            ${state.availableAudio.map(a => `<option value="${a.id}" ${layer.audio_input === a.id ? "selected" : ""}>${a.name}</option>`).join("")}
          </select></div>
        <div class="layer-prop full volume-row">
          <label>Vol</label>
          <input class="prop-input" data-prop="volume" type="range" min="0" max="2" step="0.05" value="${layer.volume || 1.0}">
        </div>`;
    } else if (layer.type === "camera") {
        propsHtml += `<div class="layer-prop full">
        <label>Device</label>
        <select class="prop-input" data-prop="source_id">${createSourceOptions(state.availableCameras, layer.source_id)}</select></div>
        <div class="layer-prop full volume-row">
          <label>Vol</label>
          <input class="prop-input" data-prop="volume" type="range" min="0" max="2" step="0.05" value="${layer.volume || 1.0}">
        </div>`;
    } else if (layer.type === "image" || layer.type === "video" || layer.type === "music") {
        propsHtml += `<div class="layer-prop full">
        <label>File Path</label>
        <div class="file-path-row">
           <input class="prop-input" data-prop="path" type="text" value="${layer.path || ""}">
           <button class="file-pick-btn" data-id="${layer.id}" type="button">Browse</button>
        </div>
        </div>`;
        if (layer.type === "video" || layer.type === "music") {
            propsHtml += `<div class="layer-prop full volume-row">
              <label>Vol</label>
              <input class="prop-input" data-prop="volume" type="range" min="0" max="2" step="0.05" value="${layer.volume || 1.0}">
            </div>
            <div class="layer-prop full video-controls-row">
              <button class="video-ctrl-btn" data-action="play" data-id="${layer.id}" ${layer.playing !== false ? 'disabled' : ''}>▶</button>
              <button class="video-ctrl-btn" data-action="pause" data-id="${layer.id}" ${layer.playing === false ? 'disabled' : ''}>⏸</button>
              <button class="video-ctrl-btn" data-action="restart" data-id="${layer.id}">↺</button>
            </div>`;
        }
    } else if (layer.type === "mic") {
        propsHtml += `<div class="layer-prop full">
        <label>Device</label>
        <select class="prop-input" data-prop="source_id">${createSourceOptions(state.availableAudio, layer.source_id)}</select></div>
        <div class="layer-prop full volume-row">
          <label>Vol</label>
          <input class="prop-input" data-prop="volume" type="range" min="0" max="2" step="0.05" value="${layer.volume || 1.0}">
        </div>`;
    }

    if (layer.type !== "mic" && layer.type !== "music") {
        propsHtml += `
          <div class="layer-prop full position-row">
            <div class="pos-input"><label>X</label><input class="prop-input" data-prop="x" type="number" value="${layer.x}"></div>
            <div class="pos-input"><label>Y</label><input class="prop-input" data-prop="y" type="number" value="${layer.y}"></div>
            <div class="pos-input"><label>W</label><input class="prop-input aspect-w" data-prop="w" type="number" value="${layer.w}"></div>
            <div class="pos-input"><label>H</label><input class="prop-input aspect-h" data-prop="h" type="number" value="${layer.h}"></div>
            <button class="aspect-lock-btn ${layer.aspectLocked ? 'locked' : ''}" data-id="${layer.id}" title="Lock aspect ratio">${layer.aspectLocked ? '🔒' : '🔓'}</button>
          </div>
        `;
    }

    card.innerHTML = `
      <div class="layer-header">
        <div class="layer-title">${layer.type.toUpperCase()}</div>
        <div class="layer-actions">
           <button class="layer-btn btn-up">▲</button>
           <button class="layer-btn btn-down">▼</button>
           <button class="layer-btn btn-toggle">${layer.active ? "👁" : "—"}</button>
           <button class="layer-btn btn-remove">✖</button>
        </div>
      </div>
      <div class="layer-props">${propsHtml}</div>
    `;

    card.querySelector(".btn-up")?.addEventListener("click", () => moveLayer(index, true));
    card.querySelector(".btn-down")?.addEventListener("click", () => moveLayer(index, false));
    card.querySelector(".btn-remove")?.addEventListener("click", () => removeLayer(layer.id));
    card.querySelector(".btn-toggle")?.addEventListener("click", () => {
        layer.active = !layer.active;
        renderLayers();
        if (state.preview) restartPreview();
    });

    const inputs = card.querySelectorAll(".prop-input");
    inputs.forEach(input => {
      input.addEventListener("change", (e) => {
         const el = e.target as HTMLInputElement | HTMLSelectElement;
         const prop = el.getAttribute("data-prop") as keyof Layer;
         const val = el.type === "number" ? parseFloat(el.value) : el.value;
         updateLayer(layer.id, prop, val);

         if (state.isLive) {
           restartStream();
         } else if (state.preview) {
           restartPreview();
         }
      });
    });

    const pickers = card.querySelectorAll(".file-pick-btn");
    pickers.forEach(btn => {
      btn.addEventListener("click", async () => {
         try {
             const selected = await open({
                 multiple: false,
                 directory: false,
             });
             if (selected && typeof selected === 'string') {
                 updateLayer(layer.id, "path", selected);
                 renderLayers();
                 if (state.preview) restartPreview();
             }
} catch(e) { console.error("File picking failed", e); }
       });
    });

    const videoCtrls = card.querySelectorAll(".video-ctrl-btn");
    videoCtrls.forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        const layerId = layer.id;
        
        if (action === "play") {
          updateLayer(layerId, "playing", true);
        } else if (action === "pause") {
          updateLayer(layerId, "playing", false);
        } else if (action === "restart") {
          updateLayer(layerId, "playing", true);
          setTimeout(() => {
            updateLayer(layerId, "playing", false);
            updateLayer(layerId, "playing", true);
          }, 50);
        }
        renderLayers();
        if (state.preview) restartPreview();
      });
    });

    const aspectLockBtn = card.querySelector(".aspect-lock-btn");
    if (aspectLockBtn) {
      aspectLockBtn.addEventListener("click", () => {
        updateLayer(layer.id, "aspectLocked", !layer.aspectLocked);
        renderLayers();
      });
    }

    // Handle aspect ratio locking for width changes
    const wInput = card.querySelector(".aspect-w") as HTMLInputElement;
    const hInput = card.querySelector(".aspect-h") as HTMLInputElement;
    
    const updateHeightFromWidth = () => {
      if (layer.aspectLocked) {
        const ratio = (layer.w || 1) / (layer.h || 1);
        const newW = parseFloat(wInput?.value || layer.w.toString());
        layer.w = newW;
        layer.h = Math.round(newW / ratio);
        if (hInput) hInput.value = layer.h.toString();
        if (state.preview) restartPreview();
      }
    };
    
    const updateWidthFromHeight = () => {
      if (layer.aspectLocked) {
        const ratio = (layer.w || 1) / (layer.h || 1);
        const newH = parseFloat(hInput?.value || layer.h.toString());
        layer.h = newH;
        layer.w = Math.round(newH * ratio);
        if (wInput) wInput.value = layer.w.toString();
        if (state.preview) restartPreview();
      }
    };
    
    if (wInput) {
      wInput.addEventListener("input", updateHeightFromWidth);
    }
    if (hInput) {
      hInput.addEventListener("input", updateWidthFromHeight);
    }

    layersList.appendChild(card);
  });
}

// --- Preview Control ---
togglePreviewBtn.addEventListener("click", async () => {
  state.preview = !state.preview;
  previewOverlay.classList.toggle("hidden", state.preview);
  previewStatus.textContent = state.preview ? "PREVIEW ON" : "PREVIEW OFF";
  
  if (state.preview) {
    await startPreview();
  } else {
    await invoke("stop_preview");
    updateCanvasPlaceholder();
  }
});

async function startPreview() {
  await invoke("start_preview", { layers: state.layers });
}

async function restartPreview() {
    await invoke("stop_preview");
    // brief yield
    setTimeout(async () => { await startPreview(); }, 300);
}

// --- Streaming Control ---
async function startStream() {
  if (state.isLive) return;

  // Stop preview if running to free up camera
  if (state.preview) {
    await invoke("stop_preview");
    // Wait for camera to be released
    await new Promise(r => setTimeout(r, 500));
  }

  const configs = [];
  if (state.platforms.twitch) {
    configs.push({
      platform: "twitch",
      url: `${ingestSelect.value}${import.meta.env.VITE_TWITCH_KEY}`
    });
  }
  if (state.platforms.kick) {
    let kickUrl = (import.meta.env.VITE_KICK_URL || "").trim();
    if (kickUrl) {
       // Ensure standard RTMP app path is present
       if (!kickUrl.includes("app")) {
          kickUrl = kickUrl.endsWith("/") ? `${kickUrl}app/` : `${kickUrl}/app/`;
       } else if (!kickUrl.endsWith("/")) {
          kickUrl += "/";
       }
    }
    const kickKey = (import.meta.env.VITE_KICK_KEY || "").trim();
    
    configs.push({
      platform: "kick",
      url: `${kickUrl}${kickKey}`
    });
  }

updateStatus("Starting Engine...");
  try {
    await invoke("start_stream", {
      configs,
      layers: state.layers,
      keyint: 60,
      encoderType: encoderSelect.value,
      quality: qualitySelect.value,
      window: appWindow,
    });

    state.isLive = true;
    state.startTime = Date.now();
    startTimer();
    startStatsPolling();
    updateUI();
    updateStatus("Live");
  } catch (e) {
    updateStatus("Error: " + e, true);
  }
}

async function stopStream() {
  await invoke("stop_stream");
  state.isLive = false;
  stopTimer();
  stopStatsPolling();
  updateUI();
  updateStatus("Ready");
}

async function restartStream() {
  const platforms = { ...state.platforms };
  const startTime = state.startTime;
  
  await invoke("stop_stream");
  state.isLive = false;
  stopTimer();
  stopStatsPolling();
  
  await new Promise(r => setTimeout(r, 300));
  
  // Restore state and restart
  state.platforms = platforms;
  state.startTime = startTime;
  await startStream();
}

actionBtn.addEventListener("click", () => {
  if (state.isLive) stopStream();
  else startStream();
});

stopBtn.addEventListener("click", async () => {
  await invoke("force_stop_stream");
  location.reload();
});

// --- Info UI Helpers ---
function updateUI() {
  actionBtn.textContent = state.isLive ? "STOP STREAM" : "GO LIVE";
  actionBtn.classList.toggle("stop-btn", state.isLive);
  liveIndicator.classList.toggle("hidden", !state.isLive);
}

function updateStatus(text: string, isError = false) {
  statusText.textContent = text;
  statusIndicator.className = "status-indicator " + (state.isLive ? "live" : isError ? "error" : "");
}

function startTimer() {
  state.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - state.startTime) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, "0");
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(diff % 60).toString().padStart(2, "0");
    timerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  timerEl.textContent = "00:00:00";
}

function startStatsPolling() {
  statCpu.textContent = "0.0";
  statGpu.textContent = "0";
  statVram.textContent = "0";
  
  state.statsInterval = setInterval(async () => {
      try {
          const stats: any = await invoke("get_system_usage");
          statCpu.textContent = (stats.cpu_app + stats.cpu_ffmpeg).toFixed(1);
          statGpu.textContent = stats.gpu_load.toString();
          statVram.textContent = stats.vram_used.toString();
      } catch (e) {}
  }, 2000);
}

function stopStatsPolling() {
    clearInterval(state.statsInterval);
}

function startStatusPolling() {
  setInterval(async () => {
    const twitchUser = import.meta.env.VITE_TWITCH_USERNAME;
    const kickUser = import.meta.env.VITE_KICK_USERNAME;
    if (state.platforms.twitch && twitchUser) checkStatus("twitch", twitchUser);
    if (state.platforms.kick && kickUser) checkStatus("kick", kickUser);
  }, 20000);
}

async function checkStatus(platform: string, user: string) {
  try {
    const isLive = await invoke<boolean>("check_twitch_channel", { username: user });
    const el = document.getElementById(`${platform}-status`);
    if (el) {
      el.classList.toggle("live", isLive);
      el.querySelector(".text")!.textContent = isLive ? "LIVE" : "OFFLINE";
    }
  } catch (e) {}
}

init();