import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

const appWindow = getCurrentWindow();

// --- State ---
const state = {
  isLive: false,
  platforms: {
    twitch: false,
    kick: false
  },
  preview: false,
  startTime: 0,
  timerInterval: null as any,
  checkInterval: null as any,
  chatCollapsed: false
};

// --- DOM Elements ---
const actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const minimizeBtn = document.getElementById("minimize-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const timerEl = document.getElementById("timer") as HTMLElement;
const liveIndicator = document.getElementById("live-indicator") as HTMLElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;

const twitchBtn = document.getElementById("toggle-twitch") as HTMLButtonElement;
const kickBtn = document.getElementById("toggle-kick") as HTMLButtonElement;
const twitchIngestGroup = document.getElementById("twitch-ingest-group") as HTMLElement;
const ingestSelect = document.getElementById("ingest") as HTMLSelectElement;

const monitorSelect = document.getElementById("monitor") as HTMLSelectElement;
const qualitySelect = document.getElementById("quality") as HTMLSelectElement;
const encoderSelect = document.getElementById("encoder") as HTMLSelectElement;

const camSelect = document.getElementById("camera-device") as HTMLSelectElement;
const camSettings = document.getElementById("camera-settings") as HTMLElement;
const camPosSelect = document.getElementById("camera-pos") as HTMLSelectElement;
const camSizeSelect = document.getElementById("camera-size") as HTMLSelectElement;

const audioInputSelect = document.getElementById("audio-input") as HTMLSelectElement;
const audioOutputSelect = document.getElementById("audio-output") as HTMLSelectElement;
const volumeInput = document.getElementById("volume-input") as HTMLInputElement;
const volumeOutput = document.getElementById("volume-output") as HTMLInputElement;

const toggleChatBtn = document.getElementById("toggle-chat") as HTMLButtonElement;
const chatSidebar = document.getElementById("chat-sidebar") as HTMLElement;

const togglePreviewBtn = document.getElementById("toggle-preview") as HTMLButtonElement;
const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const previewOverlay = document.getElementById("preview-overlay") as HTMLElement;
const previewStatus = document.getElementById("preview-status") as HTMLElement;
const fullscreenPreviewBtn = document.getElementById("fullscreen-preview") as HTMLButtonElement;

const titleBar = document.querySelector(".title-bar") as HTMLElement;

// --- Window Controls & Dragging ---
function setupWindowControls() {
  if (titleBar) {
    titleBar.addEventListener("mousedown", async (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".window-controls")) return;
      await appWindow.startDragging();
    });
  }

  if (minimizeBtn) minimizeBtn.addEventListener("click", () => appWindow.minimize());
  if (closeBtn) closeBtn.addEventListener("click", () => {
     if (state.isLive) invoke("stop_stream");
     appWindow.close();
  });

  // Fullscreen Preview logic (Browser API for canvas)
  if (fullscreenPreviewBtn) {
    fullscreenPreviewBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        previewCanvas.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    });
  }

  // Escape key to exit fullscreen
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.fullscreenElement) {
      document.exitFullscreen();
    }
  });
}

// --- Init ---
async function init() {
  console.log("OmniStream Studio V2 initializing...");
  setupWindowControls();

  try {
    await Promise.all([
      loadMonitors(),
      loadAudioDevices(),
      loadVideoDevices(),
      loadIngests()
    ]);
  } catch (err) {
    console.error("Critical device load error:", err);
  }

  updatePlatformUI();
  updateStatus("Ready");
  startStatusPolling();

  try {
    await listen<string>("preview-frame", (event) => {
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
  } catch (err) {
    console.warn("Tauri event listen error:", err);
  }
}

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
  const monitors = await invoke<any[]>("get_monitors");
  monitorSelect.innerHTML = monitors
    .map(m => `<option value="${m.id}" ${m.is_default ? 'selected' : ''}>${m.name}</option>`)
    .join("");
}

async function loadAudioDevices() {
  const devices = await invoke<any[]>("get_audio_devices");
  const inputs = devices.filter(d => d.name.includes("(Mic)"));
  const outputs = devices.filter(d => d.name.includes("(System)"));

  audioInputSelect.innerHTML = inputs.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
  audioOutputSelect.innerHTML = outputs.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
}

async function loadVideoDevices() {
  const devices = await invoke<any[]>("get_video_devices");
  camSelect.innerHTML = `<option value="none">Disabled</option>` + 
    devices.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
}

// --- Platform Handlers ---
function updatePlatformUI() {
  twitchBtn.classList.toggle("active", state.platforms.twitch);
  kickBtn.classList.toggle("active", state.platforms.kick);
  twitchIngestGroup.classList.toggle("hidden", !state.platforms.twitch);
  
  const anyActive = state.platforms.twitch || state.platforms.kick;
  actionBtn.disabled = !anyActive;
}

twitchBtn.addEventListener("click", () => {
  state.platforms.twitch = !state.platforms.twitch;
  updatePlatformUI();
});

kickBtn.addEventListener("click", () => {
  state.platforms.kick = !state.platforms.kick;
  updatePlatformUI();
});

// --- Camera & Monitor Selectors ---
camSelect.addEventListener("change", () => {
  camSettings.classList.toggle("hidden", camSelect.value === "none");
});

monitorSelect.addEventListener("change", async () => {
  if (state.preview) {
    await invoke("stop_preview");
    await startPreview();
  }
});

// --- Chat Logic ---
toggleChatBtn.addEventListener("click", () => {
  state.chatCollapsed = !state.chatCollapsed;
  chatSidebar.style.width = state.chatCollapsed ? "40px" : "var(--chat-width)";
  toggleChatBtn.textContent = state.chatCollapsed ? "»" : "«";
});

// --- Preview Control ---
togglePreviewBtn.addEventListener("click", async () => {
  state.preview = !state.preview;
  previewOverlay.classList.toggle("hidden", state.preview);
  previewStatus.textContent = state.preview ? "PREVIEW ON" : "PREVIEW OFF";
  
  if (state.preview) {
    await startPreview();
  } else {
    await invoke("stop_preview");
  }
});

async function startPreview() {
  const monId = monitorSelect.value;
  const monitors = await invoke<any[]>("get_monitors");
  const selectedMon = monitors.find(m => m.id === monId);
  const res = selectedMon ? selectedMon.resolution : "1280x720";
  
  await invoke("start_preview", { monitorId: monId, resolution: res });
}

// --- Streaming Control ---
async function startStream() {
  if (state.isLive) return;

  const configs = [];
  if (state.platforms.twitch) {
    configs.push({
      platform: "twitch",
      url: `${ingestSelect.value}${import.meta.env.VITE_TWITCH_KEY}`
    });
  }
  if (state.platforms.kick) {
    configs.push({
      platform: "kick",
      url: `${import.meta.env.VITE_KICK_URL}${import.meta.env.VITE_KICK_KEY}`
    });
  }

  updateStatus("Starting...");
  try {
    const monitors = await invoke<any[]>("get_monitors");
    const selectedMon = monitors.find(m => m.id === monitorSelect.value);
    const res = selectedMon ? selectedMon.resolution : "1280x720";

    const result = await invoke("start_stream", {
      configs,
      keyint: 60,
      encoderType: encoderSelect.value,
      monitorId: monitorSelect.value,
      resolution: res,
      quality: qualitySelect.value,
      audioInput: audioInputSelect.value || "auto",
      audioOutput: audioOutputSelect.value || "auto",
      cameraDevice: camSelect.value,
      cameraPos: camPosSelect.value,
      cameraSize: parseFloat(camSizeSelect.value),
      volumeInput: parseFloat(volumeInput.value),
      volumeOutput: parseFloat(volumeOutput.value)
    });

    state.isLive = true;
    state.startTime = Date.now();
    startTimer();
    updateUI();
    updateStatus("Live");
    console.log(res);
  } catch (e) {
    updateStatus("Error: " + e, true);
  }
}

async function stopStream() {
  await invoke("stop_stream");
  state.isLive = false;
  stopTimer();
  updateUI();
  updateStatus("Ready");
}

actionBtn.addEventListener("click", () => {
  if (state.isLive) stopStream();
  else startStream();
});

stopBtn.addEventListener("click", async () => {
  await invoke("stop_stream");
  location.reload();
});

// --- UI Helpers ---
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

function startStatusPolling() {
  state.checkInterval = setInterval(async () => {
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