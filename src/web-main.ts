import Konva from 'konva';

// --- Configuration ---
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
const WS_URL = 'ws://localhost:6970';

// --- State ---
const state = {
  isLive: false,
  layers: [] as any[],
  konvaStage: null as unknown as Konva.Stage,
  konvaLayer: null as unknown as Konva.Layer,
  transformer: null as unknown as Konva.Transformer,
  ws: null as unknown as WebSocket,
  mediaRecorder: null as unknown as MediaRecorder,
  stream: null as unknown as MediaStream,
};

// --- DOM Elements ---
const layersList = document.getElementById('layers-list')!;
const actionBtn = document.getElementById('action-btn')!;
const stopBtn = document.getElementById('stop-btn')!;
const addLayerBtn = document.getElementById('add-layer-btn')!;
const qualitySelect = document.getElementById('quality')!;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;

// --- Initialize Konva ---
function initKonva() {
  const container = document.getElementById('konva-container')!;
  
  state.konvaStage = new Konva.Stage({
    container: container.id,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
  });
  
  state.konvaLayer = new Konva.Layer();
  state.konvaStage.add(state.konvaLayer);
  
  // Create transformer for resizing/rotating
  state.transformer = new Konva.Transformer({
    anchorStroke: '#00aaff',
    anchorFill: '#0a2540',
    anchorSize: 10,
    borderStroke: '#00aaff',
    borderDash: [3, 3],
    keepRatio: true,
  });
  state.konvaLayer.add(state.transformer);
  
  // Click on stage to deselect
  state.konvaStage.on('click tap', (e) => {
    if (e.target === state.konvaStage) {
      state.transformer.nodes([]);
    }
  });
  
  // Update preview on animation
  state.konvaStage.on('layer::afterrender', () => {
    updatePreview();
  });
  
  console.log('Konva initialized:', STAGE_WIDTH, 'x', STAGE_HEIGHT);
}

// --- Preview Update ---
function updatePreview() {
  if (!state.konvaStage) return;
  
  const canvas = state.konvaStage.toCanvas();
  const ctx = previewCanvas.getContext('2d')!;
  
  // Scale down to fit preview area (480x270)
  ctx.drawImage(canvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0, 0, 480, 270);
}

// --- Layer Management ---
function addImageLayer(imageSrc: string) {
  const id = Date.now().toString();
  const img = new Image();
  img.onload = () => {
    // Calculate aspect ratio fit
    const scale = Math.min(400 / img.width, 300 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    
    const konvaImage = new Konva.Image({
      x: (STAGE_WIDTH - w) / 2,
      y: (STAGE_HEIGHT - h) / 2,
      width: w,
      height: h,
      image: img,
      draggable: true,
    });
    
    // Add to layer
    konvaImage.on('transform', () => {
      // Keep aspect ratio
      const scaleX = konvaImage.scaleX();
      const scaleY = konvaImage.scaleY();
      konvaImage.scale({ x: scaleX, y: scaleY });
    });
    
    // Click to select
    konvaImage.on('click tap', () => {
      selectLayer(id);
    });
    
    state.konvaLayer.add(konvaImage);
    
    // Add layer to state
    const layer = {
      id,
      type: 'image',
      konvaNode: konvaImage,
      active: true,
    };
    state.layers.push(layer);
    
    // Select the new layer
    selectLayer(id);
    renderLayersList();
    updatePreview();
  };
  img.src = imageSrc;
}

function selectLayer(id: string) {
  const layer = state.layers.find(l => l.id === id);
  if (layer && layer.konvaNode) {
    state.transformer.nodes([layer.konvaNode]);
    state.konvaLayer.batchDraw();
  }
}

function renderLayersList() {
  layersList.innerHTML = '';
  
  state.layers.forEach((layer, index) => {
    const div = document.createElement('div');
    div.className = 'layer-item';
    div.innerHTML = `
      <span>${layer.type} #${index + 1}</span>
      <button class="delete-btn" data-id="${layer.id}">×</button>
    `;
    div.querySelector('.delete-btn')?.addEventListener('click', () => {
      deleteLayer(layer.id);
    });
    layersList.appendChild(div);
  });
}

function deleteLayer(id: string) {
  const layer = state.layers.find(l => l.id === id);
  if (layer && layer.konvaNode) {
    layer.konvaNode.destroy();
  }
  state.layers = state.layers.filter(l => l.id !== id);
  state.transformer.nodes([]);
  renderLayersList();
  updatePreview();
}

// --- Add Layer Button ---
addLayerBtn?.addEventListener('click', () => {
  // Create file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        addImageLayer(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  input.click();
});

// --- Stream Capture ---
async function startCapture() {
  if (!state.konvaStage) return;
  
  // Get canvas stream
  const canvas = state.konvaStage.toCanvas();
  state.stream = canvas.captureStream(30); // 30 FPS
  
  // Add audio track (silent for now - can be added later)
  // const audioTrack = new MediaStreamTrack();
  // state.stream.addTrack(audioTrack);
  
  // Create MediaRecorder
  state.mediaRecorder = new MediaRecorder(state.stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 4000000, // 4 Mbps
  });
  
  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0 && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(e.data);
    }
  };
  
  state.mediaRecorder.start(100); // Send chunks every 100ms
  
  console.log('Stream capture started');
}

function stopCapture() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.stream?.getTracks().forEach(t => t.stop());
}

// --- WebSocket Connection ---
function connectWebSocket() {
  state.ws = new WebSocket(WS_URL);
  
  state.ws.onopen = () => {
    console.log('WebSocket connected');
  };
  
  state.ws.onerror = (e) => {
    console.error('WebSocket error:', e);
  };
  
  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
  };
}

// --- Start/Stop Stream ---
actionBtn.addEventListener('click', async () => {
  if (state.isLive) return;
  
  // Connect to WebSocket
  connectWebSocket();
  
  // Wait for connection
  await new Promise<void>((resolve) => {
    if (state.ws?.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      state.ws!.onopen = () => resolve();
    }
  });
  
  // Get stream config
  const config = {
    twitchKey: (document.getElementById('toggle-twitch') as HTMLInputElement)?.checked 
      ? 'live_426247186_1Q6nNt5i2st6kmiVHft3hWXTKbhdIi' // Replace with actual
      : null,
    kickUrl: (document.getElementById('toggle-kick') as HTMLInputElement)?.checked
      ? (document.getElementById('kick-url') as HTMLInputElement)?.value
      : null,
    bitrate: (qualitySelect as HTMLSelectElement).value === '1080p60' ? '6000k' : '4500k',
  };
  
  // Send config first
  state.ws?.send(JSON.stringify(config));
  
  // Start capture
  await startCapture();
  
  state.isLive = true;
  actionBtn.textContent = 'LIVE';
  actionBtn.classList.add('live');
  (stopBtn as HTMLButtonElement).disabled = false;
});

stopBtn.addEventListener('click', () => {
  if (!state.isLive) return;
  
  stopCapture();
  state.ws?.close();
  
  state.isLive = false;
  actionBtn.textContent = 'GO LIVE';
  actionBtn.classList.remove('live');
  (stopBtn as HTMLButtonElement).disabled = true;
});

// --- Preview Update Loop ---
function startPreviewLoop() {
  setInterval(() => {
    updatePreview();
  }, 100); // 10 FPS preview update
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  initKonva();
  startPreviewLoop();
  console.log('OmniStream Studio initialized');
});

export {};