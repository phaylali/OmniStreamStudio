import Konva from 'konva';
import html2canvas from 'html2canvas';

console.log('main.ts loaded');

// --- Configuration ---
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
const ASPECT_RATIO = 16 / 9;
const WS_URL = 'ws://localhost:6970';
const PROXY_URL = 'http://localhost:6971/proxy?url=';
const LOCAL_URL = 'http://localhost:6971/local?path=';

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
  // Undo/Redo
  history: [] as any[],
  historyIndex: -1,
  maxHistory: 50,
};

// --- DOM Elements ---
const layersList = document.getElementById('layers-list')!;
const actionBtn = document.getElementById('action-btn')!;
const stopBtn = document.getElementById('stop-btn')!;
const addLayerBtn = document.getElementById('add-layer-btn')!;
const qualitySelect = document.getElementById('quality')!;
const canvasWrapper = document.getElementById('canvas-wrapper')!;
const previewCanvas = document.createElement('canvas') as HTMLCanvasElement;
const undoBtn = document.getElementById('undo-btn')!;
const redoBtn = document.getElementById('redo-btn')!;
const deleteBtn = document.getElementById('delete-btn')!;

// --- Undo/Redo System ---
function saveState() {
  // Remove any future states if we're not at the end
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  
  // Save current state
  const stateData = state.layers.map(layer => ({
    id: layer.id,
    type: layer.type,
    x: layer.konvaNode.x(),
    y: layer.konvaNode.y(),
    width: layer.konvaNode.width(),
    height: layer.konvaNode.height(),
    scaleX: layer.konvaNode.scaleX(),
    scaleY: layer.konvaNode.scaleY(),
    rotation: layer.konvaNode.rotation(),
  }));
  
  state.history.push(stateData);
  
  // Limit history size
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  
  updateUndoRedoButtons();
}

function undo() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    restoreState(state.history[state.historyIndex]);
  }
}

function redo() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    restoreState(state.history[state.historyIndex]);
  }
}

function restoreState(stateData: any[]) {
  // Restore all layer positions
  stateData.forEach((data: any) => {
    const layer = state.layers.find(l => l.id === data.id);
    if (layer && layer.konvaNode) {
      layer.konvaNode.position({ x: data.x, y: data.y });
      layer.konvaNode.size({ width: data.width, height: data.height });
      layer.konvaNode.scale({ x: data.scaleX, y: data.scaleY });
      layer.konvaNode.rotation(data.rotation);
    }
  });
  state.konvaLayer.batchDraw();
  updatePreview();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  (undoBtn as HTMLButtonElement).disabled = state.historyIndex <= 0;
  (redoBtn as HTMLButtonElement).disabled = state.historyIndex >= state.history.length - 1;
}

function deleteSelectedLayer() {
  const selectedNodes = state.transformer.nodes();
  if (selectedNodes.length === 0) return;
  
  const node = selectedNodes[0];
  const layer = state.layers.find(l => l.konvaNode === node);
  
  if (layer) {
    saveState();
    layer.konvaNode.destroy();
    state.layers = state.layers.filter(l => l.id !== layer.id);
    state.transformer.nodes([]);
    renderLayersList();
    updatePreview();
  }
}

// --- Canvas Resize ---
function resizeCanvas() {
  const wrapper = canvasWrapper;
  const container = wrapper.querySelector('.preview-container') as HTMLElement;
  if (!container) return;
  
  const wrapperRect = wrapper.getBoundingClientRect();
  let availableWidth = wrapperRect.width - 40; // padding
  let availableHeight = wrapperRect.height - 40;
  
  // Guard against invalid sizes
  if (availableWidth < 100 || availableHeight < 100) {
    return;
  }
  
  let width = availableWidth;
  let height = width / ASPECT_RATIO;
  
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ASPECT_RATIO;
  }
  
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  
  console.log('Canvas resized:', width, 'x', height);
  
  if (state.konvaStage) {
    state.konvaStage.width(STAGE_WIDTH);
    state.konvaStage.height(STAGE_HEIGHT);
  }
  
  console.log('Canvas resized:', width, 'x', height);
}

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
  
  // Save state on transform end
  state.transformer.on('transformend', () => {
    saveState();
  });
  
  // Initial resize
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  console.log('Konva initialized:', STAGE_WIDTH, 'x', STAGE_HEIGHT);
}

// --- Preview Update ---
function updatePreview() {
  if (!state.konvaStage) return;
  
  const container = document.getElementById('konva-container')!;
  const canvas = state.konvaStage.toCanvas();
  
  // Convert to image data URL and display as background
  const dataUrl = canvas.toDataURL();
  
  // Find or create the preview image
  let previewImg = container.querySelector('img') as HTMLImageElement;
  if (!previewImg) {
    previewImg = document.createElement('img');
    previewImg.style.display = 'block';
    previewImg.style.width = '100%';
    previewImg.style.height = '100%';
    previewImg.style.objectFit = 'contain';
    container.appendChild(previewImg);
  }
  previewImg.src = dataUrl;
}

// --- Layer Management ---
function addImageLayer(imageSrc: string) {
  if (!state.konvaLayer) {
    console.error('Konva not initialized yet');
    return;
  }
  
  const id = Date.now().toString();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  
  // Use proxy for URLs to bypass CORS
  const src = imageSrc.startsWith('http') ? PROXY_URL + encodeURIComponent(imageSrc) : imageSrc;
  console.log('Loading image from:', src);
  
  img.onload = () => {
    console.log('Image loaded:', img.width, 'x', img.height);
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
  
  img.onerror = () => {
    console.error('Failed to load image:', imageSrc);
  };
  
  img.src = src;
}

function selectLayer(id: string) {
  const layer = state.layers.find(l => l.id === id);
  if (layer && layer.konvaNode) {
    state.transformer.nodes([layer.konvaNode]);
    state.konvaLayer.batchDraw();
  }
}

// --- HTML Layer (placeholder - loads as image) ---
function addHtmlLayer(url: string) {
  if (!state.konvaLayer) {
    console.error('Konva not initialized yet');
    return;
  }
  
  console.log('addHtmlLayer called with:', url);
  const id = Date.now().toString();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  
  // Use proxy to bypass CORS for remote URLs
  let src = url;
  if (url.startsWith('http')) {
    src = PROXY_URL + encodeURIComponent(url);
    console.log('Loading via proxy:', src);
  }
  
  img.onload = () => {
    console.log('Image loaded, size:', img.width, 'x', img.height);
    const scale = Math.min(800 / img.width, 450 / img.height);
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
    
    konvaImage.on('click tap', () => {
      selectLayer(id);
    });
    
    state.konvaLayer.add(konvaImage);
    
    const layer = {
      id,
      type: 'html',
      konvaNode: konvaImage,
      active: true,
    };
    state.layers.push(layer);
    
    selectLayer(id);
    renderLayersList();
    updatePreview();
    console.log('HTML layer added:', id);
  };
  img.onerror = () => {
    console.error('Failed to load HTML content:', url);
  };
  img.src = src;
}

function addHtmlLayerUrl(dataUrl: string) {
  if (!dataUrl) return;
  
  // If it's a data URL containing HTML, we can't render it as image
  // For local HTML files, we'd need html2canvas which is complex
  // Instead, try to load as image (works for PNG/JPG data URLs)
  addHtmlLayer(dataUrl);
}

// --- Text Layer ---
function addTextLayer(text: string, fontSize: number, color: string) {
  if (!state.konvaLayer) {
    console.error('Konva not initialized yet');
    return;
  }
  
  const id = Date.now().toString();
  
  const konvaText = new Konva.Text({
    x: STAGE_WIDTH / 2,
    y: STAGE_HEIGHT / 2,
    text: text,
    fontSize: fontSize,
    fontFamily: 'Inter, Arial, sans-serif',
    fill: color,
    draggable: true,
  });
  
  // Center the text
  konvaText.offsetX(konvaText.width() / 2);
  konvaText.offsetY(konvaText.height() / 2);
  
  konvaText.on('click tap', () => {
    selectLayer(id);
  });
  
  state.konvaLayer.add(konvaText);
  
  const layer = {
    id,
    type: 'text',
    konvaNode: konvaText,
    active: true,
  };
  state.layers.push(layer);
  
  selectLayer(id);
  renderLayersList();
  updatePreview();
  console.log('Text layer added:', id);
}

// --- HTML Overlay Layer ---
interface HtmlOverlayLayer {
  id: string;
  type: string;
  konvaNode: Konva.Image;
  container: HTMLElement;
  active: boolean;
  fps: number;
  running: boolean;
  intervalId: number;
  eventData: any;
}

const htmlOverlayLayers: Map<string, HtmlOverlayLayer> = new Map();

async function renderHtmlOverlay(id: string) {
  const overlay = htmlOverlayLayers.get(id);
  if (!overlay || !overlay.running || !overlay.container) return;
  
  try {
    const container = overlay.container;
    const canvas = await html2canvas(container, {
      width: container.offsetWidth || 400,
      height: container.offsetHeight || 200,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
    });
    
    // Update existing Konva image
    overlay.konvaNode.image(canvas);
    state.konvaLayer?.batchDraw();
  } catch (e) {
    console.error('Failed to render HTML overlay:', e);
  }
}

function startHtmlOverlayRenderLoop(id: string) {
  const overlay = htmlOverlayLayers.get(id);
  if (!overlay) return;
  
  const intervalMs = 1000 / overlay.fps;
  
  const loop = async () => {
    if (!overlay.running) return;
    await renderHtmlOverlay(id);
    overlay.intervalId = window.setTimeout(loop, intervalMs);
  };
  
  overlay.running = true;
  loop();
}

function addHtmlOverlayLayer(htmlContent: string, fps: number = 30, width: number = 400, height: number = 200) {
  if (!state.konvaLayer) {
    console.error('Konva not initialized yet');
    return;
  }
  
  const id = Date.now().toString();
  
  // Create hidden container for HTML
  const container = document.createElement('div');
  container.id = `html-overlay-${id}`;
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: ${width}px;
    height: ${height}px;
    background: transparent;
    pointer-events: none;
    overflow: hidden;
  `;
  container.innerHTML = htmlContent;
  document.body.appendChild(container);
  
  // Create Konva image to hold the rendered HTML
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  
  const konvaImage = new Konva.Image({
    x: (STAGE_WIDTH - width) / 2,
    y: (STAGE_HEIGHT - height) / 2,
    width: width,
    height: height,
    image: tempCanvas,
    draggable: true,
  });
  
  konvaImage.on('click tap', () => {
    selectLayer(id);
  });
  
  state.konvaLayer.add(konvaImage);
  
  const overlay: HtmlOverlayLayer = {
    id,
    type: 'html',
    konvaNode: konvaImage,
    container,
    active: true,
    fps,
    running: true,
    intervalId: 0,
    eventData: {},
  };
  
  htmlOverlayLayers.set(id, overlay);
  
  // Start render loop
  startHtmlOverlayRenderLoop(id);
  
  const layer = {
    id,
    type: 'html',
    konvaNode: konvaImage,
    active: true,
  };
  state.layers.push(layer);
  
  selectLayer(id);
  renderLayersList();
  updatePreview();
  console.log('HTML overlay layer added:', id);
}

// Update HTML overlay with event data
function updateHtmlOverlayData(id: string, data: any) {
  const overlay = htmlOverlayLayers.get(id);
  if (!overlay) return;
  
  overlay.eventData = data;
  
  // Dispatch custom event for HTML to handle
  overlay.container.dispatchEvent(new CustomEvent('overlay-event', {
    detail: data
  }));
}

// Remove HTML overlay layer
function removeHtmlOverlayLayer(id: string) {
  const overlay = htmlOverlayLayers.get(id);
  if (overlay) {
    overlay.running = false;
    if (overlay.intervalId) {
      clearTimeout(overlay.intervalId);
    }
    if (overlay.container && overlay.container.parentNode) {
      overlay.container.parentNode.removeChild(overlay.container);
    }
    htmlOverlayLayers.delete(id);
  }
}

function renderLayersList() {
  layersList.innerHTML = '';
  
  state.layers.forEach((layer, index) => {
    const div = document.createElement('div');
    div.className = 'layer-item';
    div.innerHTML = `
      <span>${layer.type} #${index + 1}</span>
      <button class="delete-btn" data-id="${layer.id}" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
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
    saveState();
    layer.konvaNode.destroy();
  }
  
  // Also clean up HTML overlay resources
  removeHtmlOverlayLayer(id);
  
  state.layers = state.layers.filter(l => l.id !== id);
  state.transformer.nodes([]);
  renderLayersList();
  updatePreview();
}

// --- Dialog Elements ---
const dialog = document.getElementById('add-layer-dialog')!;
const dialogClose = document.getElementById('dialog-close')!;
const dialogTabs = dialog.querySelectorAll('.dialog-tab');
const dialogPanels = dialog.querySelectorAll('.dialog-panel');
const imageFileInput = document.getElementById('image-file-input') as HTMLInputElement;
const selectImageBtn = document.getElementById('select-image-btn')!;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const loadUrlBtn = document.getElementById('load-url-btn')!;
const htmlUrlInput = document.getElementById('html-url-input') as HTMLInputElement;
const htmlFileInput = document.getElementById('html-file-input') as HTMLInputElement;
const selectHtmlBtn = document.getElementById('select-html-btn')!;
const loadHtmlBtn = document.getElementById('load-html-btn')!;

console.log('Dialog elements:', { dialog, loadHtmlBtn, htmlUrlInput });

// --- Dialog Functions ---
function openDialog() {
  dialog.classList.remove('hidden');
  dialog.style.display = 'flex';
}

function closeDialog() {
  dialog.classList.add('hidden');
  dialog.style.display = 'none';
}

function setDialogTab(type: string) {
  dialogTabs.forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-type') === type);
  });
  dialogPanels.forEach(panel => {
    panel.classList.toggle('active', panel.getAttribute('data-panel') === type);
  });
}

// --- Add Layer Button ---
addLayerBtn?.addEventListener('click', openDialog);

dialogClose.addEventListener('click', closeDialog);

dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closeDialog();
});

dialogTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setDialogTab(tab.getAttribute('data-type')!);
  });
});

// Image tab
selectImageBtn.addEventListener('click', () => imageFileInput.click());
imageFileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      saveState();
      addImageLayer(e.target?.result as string);
      closeDialog();
    };
    reader.readAsDataURL(file);
  }
});

// URL tab
loadUrlBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) {
    saveState();
    addImageLayer(url);
    closeDialog();
  }
});

// HTML tab - URL option
console.log('Setting up loadHtmlBtn listener');
loadHtmlBtn.addEventListener('click', async () => {
  try {
    console.log('Load HTML clicked');
    loadHtmlBtn.textContent = 'Loading...';
    (loadHtmlBtn as HTMLButtonElement).disabled = true;
    
    const url = htmlUrlInput.value.trim();
    console.log('URL value:', url);
    if (url) {
      saveState();
      
      // Determine if it's a local file or remote URL
      let fetchUrl;
      if (url.startsWith('/') || url.startsWith('overlays/')) {
        // Local file - prefix with local endpoint
        const path = url.startsWith('/') ? url.slice(1) : url;
        fetchUrl = LOCAL_URL + encodeURIComponent(path);
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        // Remote URL
        fetchUrl = PROXY_URL + encodeURIComponent(url);
      } else {
        // Treat as filename in overlays folder
        fetchUrl = LOCAL_URL + encodeURIComponent('overlays/' + url);
      }
      
      console.log('Fetching from:', fetchUrl);
      const response = await fetch(fetchUrl);
      
      if (!response.ok) {
        throw new Error('File not found: ' + response.status);
      }
      
      const html = await response.text();
      console.log('HTML loaded, length:', html.length);
      addHtmlOverlayLayer(html, 30, 400, 200);
      closeDialog();
    }
  } catch (e) {
    console.error('Error in loadHtmlBtn:', e);
    alert('Failed to load HTML: ' + (e as Error).message);
  } finally {
    loadHtmlBtn.textContent = 'Load HTML';
    (loadHtmlBtn as HTMLButtonElement).disabled = false;
  }
});

htmlUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    loadHtmlBtn.click();
  }
});

// Text tab
const textInput = document.getElementById('text-input') as HTMLInputElement;
const textFontSize = document.getElementById('text-font-size') as HTMLSelectElement;
const textColor = document.getElementById('text-color') as HTMLInputElement;
const addTextBtn = document.getElementById('add-text-btn') as HTMLButtonElement;

addTextBtn?.addEventListener('click', () => {
  const text = textInput.value.trim();
  if (text) {
    saveState();
    addTextLayer(text, parseInt(textFontSize.value), textColor.value);
    closeDialog();
  }
});

textInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addTextBtn.click();
  }
});

// HTML tab - File option
selectHtmlBtn.addEventListener('click', () => htmlFileInput.click());
htmlFileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    saveState();
    const reader = new FileReader();
    reader.onload = (e) => {
      addHtmlOverlayLayer(e.target?.result as string, 30, 400, 200);
      closeDialog();
    };
    reader.readAsText(file);
  }
});

// --- Undo/Redo/Delete Buttons ---
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
deleteBtn.addEventListener('click', deleteSelectedLayer);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Z = undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  // Ctrl+Shift+Z or Ctrl+Y = redo
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  }
  // Delete/Backspace = delete selected
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const selectedNodes = state.transformer.nodes();
    if (selectedNodes.length > 0) {
      e.preventDefault();
      deleteSelectedLayer();
    }
  }
});

// --- WebCodecs Stream Capture ---
let encoder: VideoEncoder | null = null;
let muxer: any = null;
let captureInterval: number | null = null;
let frameCount = 0;

// Check if WebCodecs is available
function webCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && 
         VideoEncoder.isConfigSupported !== undefined;
}

async function startCapture() {
  if (!state.konvaStage) return;
  
  console.log('WebCodecs supported:', webCodecsSupported());
  
  if (!webCodecsSupported()) {
    console.log('WebCodecs not supported, using fallback');
    startCaptureFallback();
    return;
  }
  
  try {
    const canvas = state.konvaStage.toCanvas();
    console.log('Canvas:', canvas.width, 'x', canvas.height);
    
    // VideoEncoder config - H.264 (use 720p to fit AVC level 3.0)
    const width = 1280;
    const height = 720;
    const encoderConfig: VideoEncoderConfig = {
      codec: 'avc1.42001F',  // H.264 main profile level 3.1
      width,
      height,
      bitrate: 4000000,
      framerate: 30,
    };
    
    // Check codec support
    if (!VideoEncoder.isConfigSupported(encoderConfig)) {
      encoderConfig.codec = 'avc1.42001F';  // Try main profile
    }
    if (!VideoEncoder.isConfigSupported(encoderConfig)) {
      console.log('H.264 not supported, trying VP9');
      encoderConfig.codec = 'vp09.00.10.08';  // VP9
    }
    
    console.log('Using codec:', encoderConfig.codec);
    console.log('Codec supported:', VideoEncoder.isConfigSupported(encoderConfig));
    
    if (!VideoEncoder.isConfigSupported(encoderConfig)) {
      throw new Error('No supported codec found');
    }
    
    // Create encoder
    encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, metadata: any) => {
        // Get chunk data
        const chunkData = new Uint8Array(chunk.byteLength);
        chunk.copyTo(chunkData);
        
        // Send encoded chunk with metadata
        const msg = {
          type: 'video_chunk',
          data: Array.from(chunkData),
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          isKeyFrame: chunk.type === 'key',
          codec: encoderConfig.codec
        };
        
        if (state.ws?.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify(msg));
          frameCount++;
          if (frameCount % 30 === 0) {
            console.log('Sent encoded frame', frameCount, 'size:', chunkData.length, 'key:', chunk.type === 'key');
          }
        }
      },
      error: (e: Error) => {
        console.error('Encoder error:', e);
      }
    });
    
    encoder.configure(encoderConfig);
    console.log('VideoEncoder configured');
    
    // Capture loop
    let timestamp = 0;
    const frameDuration = 33333;  // 30fps in microseconds
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    
    const captureFrame = () => {
      if (!encoder || encoder.state === 'closed') return;
      try {
        state.konvaStage!.draw();
        const c = state.konvaStage!.toCanvas();
        tempCtx.drawImage(c, 0, 0, width, height);
        const frame = new VideoFrame(tempCanvas, { timestamp });
        encoder.encode(frame, { keyFrame: true });
        frame.close();
        timestamp += frameDuration;
      } catch (e) {
        console.error('Frame error:', e);
      }
    };
    
    // Start capturing at 30fps
    captureInterval = window.setInterval(captureFrame, 33);
    console.log('WebCodecs capture started');
    
  } catch (e) {
    console.error('WebCodecs failed:', e);
    console.log('Falling back to JPEG');
    startCaptureFallback();
  }
}

function startCaptureFallback() {
  const width = 1280;
  const height = 720;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d')!;
  
  const captureFrames = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    
    state.konvaStage!.draw();
    const c = state.konvaStage!.toCanvas();
    tempCtx.drawImage(c, 0, 0, width, height);
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.7);
    
    if (dataUrl.length > 1000) {
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      state.ws.send(bytes);
      frameCount++;
      
      if (frameCount % 30 === 0) {
        console.log('Sent frame', frameCount, 'size:', bytes.length);
      }
    }
  };
  
  captureInterval = window.setInterval(captureFrames, 66);
  console.log('Fallback capture started');
}

function stopCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  
  // Stop encoder
  if (encoder) {
    encoder.flush();
    encoder.close();
    encoder = null;
  }
  
  // Stop muxer
  if (muxer) {
    muxer.finalize();
    muxer = null;
  }
  
  console.log('Capture stopped, frames sent:', frameCount);
  frameCount = 0;
}

// --- WebSocket Connection ---
function connectWebSocket() {
  state.ws = new WebSocket(WS_URL);
  
  state.ws.onopen = () => {
    console.log('WebSocket connected');
  };
  
  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      // Handle events (follows, alerts, etc.)
      if (msg.type === 'event' && msg.data) {
        handleOverlayEvent(msg.data);
      }
    } catch (e) {
      // Not JSON, ignore
    }
  };
  
  state.ws.onerror = (e) => {
    console.error('WebSocket error:', e);
  };
  
  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
  };
}

// Handle events from server
function handleOverlayEvent(event: any) {
  const type = event.type;
  const data = event.data || event;
  
  console.log('Overlay event:', type, data);
  
  // Update all HTML overlays with the event
  // The HTML can listen for 'overlay-event' custom event
  // For now, just log - the HTML needs to set up listeners itself
  htmlOverlayLayers.forEach((overlay, id) => {
    updateHtmlOverlayData(id, { type, ...data });
  });
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
  
// Get stream config - check button classList for active state
  const twitchBtn = document.getElementById('toggle-twitch');
  const kickBtn = document.getElementById('toggle-kick');
  
  const config = {
    twitchKey: twitchBtn?.classList.contains('active') ? 'using_env' : null,
    kickUrl: kickBtn?.classList.contains('active') ? 'using_env' : null,
    bitrate: (qualitySelect as HTMLSelectElement).value === '1080p60' ? '6000k' : '4500k',
    codec: 'avc1.42001E',
  };
  
  console.log('Config:', config);
  
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
  try {
    console.log('DOM loaded, initializing...');
    
    // Platform toggle handlers
    const twitchBtn = document.getElementById('toggle-twitch');
    const kickBtn = document.getElementById('toggle-kick');
    
    if (twitchBtn) {
      twitchBtn.addEventListener('click', () => {
        twitchBtn.classList.toggle('active');
        console.log('Twitch:', twitchBtn.classList.contains('active'));
      });
    }
    
    if (kickBtn) {
      kickBtn.addEventListener('click', () => {
        kickBtn.classList.toggle('active');
        console.log('Kick:', kickBtn.classList.contains('active'));
      });
    }
    
    initKonva();
    startPreviewLoop();
    console.log('OmniStream Studio initialized');
  } catch (e) {
    console.error('Init error:', e);
  }
});

export {};