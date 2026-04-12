import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Platform = "twitch" | "kick";

interface StreamState {
  platform: Platform;
  streamKey: string;
  ingestUrl: string;
  isLive: boolean;
  startTime: number | null;
}

// Default keys loaded from .env at build time
declare const TWITCH_KEY: string;
declare const KICK_KEY: string;
declare const TWITCH_USERNAME: string;

const DEFAULT_KEYS: Record<Platform, string> = {
  twitch: typeof TWITCH_KEY !== 'undefined' ? TWITCH_KEY : "",
  kick: typeof KICK_KEY !== 'undefined' ? KICK_KEY : ""
};

const CHANNEL_NAME = typeof TWITCH_USERNAME !== 'undefined' ? TWITCH_USERNAME : "";

const TWITCH_INGESTS = [
  { name: "Auto (Recommended)", url: "rtmps://ingest.global-contribute.live-video.net/app" },
  { name: "Europe (Paris)", url: "rtmps://euw30.contribute.live-video.net/app" },
  { name: "Europe (Frankfurt)", url: "rtmps://euc10.contribute.live-video.net/app" },
  { name: "Europe (Ireland)", url: "rtmps://euw10.contribute.live-video.net/app" },
  { name: "Europe (Stockholm)", url: "rtmps://eun10.contribute.live-video.net/app" },
  { name: "US East (N. Virginia)", url: "rtmps://use10.contribute.live-video.net/app" },
  { name: "US East (Ohio)", url: "rtmps://use20.contribute.live-video.net/app" },
  { name: "US West (Oregon)", url: "rtmps://usw20.contribute.live-video.net/app" },
];

const KICK_INGESTS = [
  { name: "Kick (Default)", url: "rtmps://live-kick.edge.kick.com/app" },
];

let state: StreamState = {
  platform: "twitch",
  streamKey: "",
  ingestUrl: "",
  isLive: false,
  startTime: null,
};

let timerInterval: number | null = null;

const platformSelect = document.getElementById("platform") as HTMLSelectElement;
const streamKeyInput = document.getElementById("stream-key") as HTMLInputElement;
const ingestSelect = document.getElementById("ingest") as HTMLSelectElement;
const actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const toggleKeyBtn = document.getElementById("toggle-key") as HTMLButtonElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const timerEl = document.getElementById("timer") as HTMLElement;
const minimizeBtn = document.getElementById("minimize-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const channelIndicator = document.getElementById("channel-indicator") as HTMLElement;
const channelText = document.getElementById("channel-text") as HTMLElement;
const keyintSelect = document.getElementById("keyint") as HTMLSelectElement;
const encoderSelect = document.getElementById("encoder") as HTMLSelectElement;

let channelCheckInterval: number | null = null;

async function checkChannelStatus() {
  if (!CHANNEL_NAME) {
    channelText.textContent = "No channel configured";
    return;
  }

  try {
    console.log("Checking channel status for:", CHANNEL_NAME);
    const isLive = await invoke<boolean>("check_twitch_channel", { username: CHANNEL_NAME, clientId: "" });
    
    if (isLive) {
      channelIndicator.className = "channel-indicator live";
      channelText.textContent = `${CHANNEL_NAME} is live`;
    } else {
      channelIndicator.className = "channel-indicator offline";
      channelText.textContent = `${CHANNEL_NAME} is offline`;
    }
  } catch (error: any) {
    console.error("Channel check error:", error);
    channelIndicator.className = "channel-indicator error";
    const errorMessage = error?.message || error?.toString() || "Unknown error";
    channelText.textContent = `Error: ${errorMessage}`;
  }
}

function startChannelCheck() {
  if (channelCheckInterval) return;
  checkChannelStatus();
  channelCheckInterval = window.setInterval(checkChannelStatus, 10000);
}

function updateIngestDropdown() {
  const ingests = state.platform === "twitch" ? TWITCH_INGESTS : KICK_INGESTS;
  ingestSelect.innerHTML = ingests
    .map((ingest, index) => `<option value="${ingest.url}" ${index === 0 ? "selected" : ""}>${ingest.name}</option>`)
    .join("");
}

function loadDefaultKey() {
  const defaultKey = DEFAULT_KEYS[state.platform];
  if (defaultKey) {
    streamKeyInput.value = defaultKey;
    state.streamKey = defaultKey;
  }
}

function updateStatus(text: string, statusClass: "live" | "error" | "" = "") {
  statusText.textContent = text;
  statusIndicator.className = "status-indicator" + (statusClass ? ` ${statusClass}` : "");
}

function startTimer() {
  if (timerInterval) return;
  state.startTime = Date.now();
  timerInterval = window.setInterval(() => {
    if (!state.startTime) return;
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const hours = Math.floor(elapsed / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
    const seconds = (elapsed % 60).toString().padStart(2, "0");
    timerEl.textContent = `${hours}:${minutes}:${seconds}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = "";
  state.startTime = null;
}

async function startStream() {
  const streamKey = streamKeyInput.value.trim();
  if (!streamKey) {
    updateStatus("Stream key required", "error");
    return;
  }

  const ingestUrl = ingestSelect.value;
  const fullUrl = `${ingestUrl}/${streamKey}`;

  actionBtn.disabled = true;
  actionBtn.textContent = "Starting...";
  updateStatus("Starting stream... Check console for details.");

  try {
    const keyint = keyintSelect.value;
    const encoder = encoderSelect.value;
    const result = await invoke<string>("start_stream", {
      platform: state.platform,
      url: fullUrl,
      keyint: parseInt(keyint, 10),
      encoderType: encoder,
    });
    console.log("Start result:", result);
    
    state.isLive = true;
    actionBtn.textContent = "END STREAM";
    actionBtn.classList.add("live");
    actionBtn.disabled = false;
    updateStatus("Live", "live");
    startTimer();
  } catch (error: any) {
    console.error("Stream error:", error);
    const errorMsg = error?.toString() || "Unknown error";
    updateStatus(`Error: ${errorMsg}`, "error");
    actionBtn.textContent = "GO LIVE";
    actionBtn.disabled = false;
  }
}

async function stopStream() {
  actionBtn.disabled = true;
  actionBtn.textContent = "Stopping...";
  updateStatus("Stopping stream...");

  try {
    await invoke("stop_stream");
    state.isLive = false;
    stopTimer();
    actionBtn.textContent = "GO LIVE";
    actionBtn.classList.remove("live");
    actionBtn.disabled = false;
    updateStatus("Ready");
  } catch (error) {
    console.error("Stop error:", error);
    updateStatus(`Error: ${error}`, "error");
    actionBtn.disabled = false;
  }
}

async function forceStopStream() {
  stopBtn.disabled = true;
  stopBtn.textContent = "Killing...";
  updateStatus("Force stopping...");

  try {
    await invoke("force_stop_stream");
  } catch (error) {
    console.error("Force stop error:", error);
  }
  
  state.isLive = false;
  stopTimer();
  actionBtn.textContent = "GO LIVE";
  actionBtn.classList.remove("live");
  actionBtn.disabled = false;
  stopBtn.disabled = false;
  stopBtn.textContent = "STOP";
  updateStatus("Ready");
}

platformSelect.addEventListener("change", () => {
  state.platform = platformSelect.value as Platform;
  updateIngestDropdown();
});

actionBtn.addEventListener("click", () => {
  if (state.isLive) {
    stopStream();
  } else {
    startStream();
  }
});

stopBtn.addEventListener("click", () => {
  forceStopStream();
});

toggleKeyBtn.addEventListener("click", () => {
  streamKeyInput.type = streamKeyInput.type === "password" ? "text" : "password";
});

minimizeBtn.addEventListener("click", async () => {
  const win = getCurrentWindow();
  await win.minimize();
});

closeBtn.addEventListener("click", async () => {
  if (state.isLive) {
    await stopStream();
  }
  const win = getCurrentWindow();
  await win.close();
});

updateIngestDropdown();
loadDefaultKey();
startChannelCheck();
updateStatus("Ready");

async function initEncoders() {
  try {
    const encoders = await invoke<any[]>("get_available_encoders");

    encoderSelect.innerHTML = `<option value="auto">Auto (Recommended)</option>`;

    // Group encoders by type
    const gpuEncoders = encoders.filter(e => e.type_ === "gpu");
    const igpuEncoders = encoders.filter(e => e.type_ === "igpu");
    const cpuEncoders = encoders.filter(e => e.type_ === "cpu");

    // Add detected encoders to dropdown
    gpuEncoders.forEach(encoder => {
      encoderSelect.innerHTML += `<option value="gpu">${encoder.name}</option>`;
    });

    igpuEncoders.forEach(encoder => {
      encoderSelect.innerHTML += `<option value="igpu">${encoder.name}</option>`;
    });

    cpuEncoders.forEach(encoder => {
      encoderSelect.innerHTML += `<option value="cpu">${encoder.name}</option>`;
    });

    // If no encoders of a type found, add generic options
    if (gpuEncoders.length === 0) {
      encoderSelect.innerHTML += `<option value="gpu">GPU (Hardware)</option>`;
    }
    if (igpuEncoders.length === 0) {
      encoderSelect.innerHTML += `<option value="igpu">Integrated GPU</option>`;
    }
    if (cpuEncoders.length === 0) {
      encoderSelect.innerHTML += `<option value="cpu">CPU (Software)</option>`;
    }
  } catch (error) {
    console.error("Failed to load encoders:", error);
    encoderSelect.innerHTML = `
      <option value="auto">Auto (Recommended)</option>
      <option value="gpu">GPU (Hardware)</option>
      <option value="igpu">Integrated GPU</option>
      <option value="cpu">CPU (Software)</option>
    `;
  }
}

initEncoders();