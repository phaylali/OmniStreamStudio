import Konva from 'konva';
import html2canvas from 'html2canvas';
import { Output, Mp4OutputFormat, CanvasSource, StreamTarget, VideoEncodingConfig } from 'mediabunny';

console.log('main.ts loaded');

// --- Configuration ---
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
const ASPECT_RATIO = 16 / 9;
const WS_URL = 'ws://localhost:6970';
const PROXY_URL = 'http://localhost:6971/proxy?url=';
const LOCAL_URL = 'http://localhost:6971/local?path=';

// --- State ---
interface LayerConfig {
  id: string;
  type: string;
  konvaNode?: any;
  active: boolean;
  textConfig?: { text: string; fontSize: number; color: string; fontFamily: string };
  widgetConfig?: any;
  imageConfig?: { opacity: number; scaleX: number; scaleY: number };
}

interface Scene {
  id: string;
  name: string;
  layers: LayerConfig[];
}

const state = {
  isLive: false,
  layers: [] as any[],
  konvaStage: null as unknown as Konva.Stage,
  konvaLayer: null as unknown as Konva.Layer,
  transformer: null as unknown as Konva.Transformer,
  ws: null as unknown as WebSocket,
  mediaRecorder: null as unknown as MediaRecorder,
  stream: null as unknown as MediaStream,
  // Scenes
  scenes: [] as Scene[],
  activeSceneId: 'default',
  // Undo/Redo
  history: [] as any[],
  historyIndex: -1,
  maxHistory: 50,
};

// --- DOM Elements ---
let layersList: HTMLElement;
let actionBtn: HTMLElement;
let stopBtn: HTMLElement;
let addLayerBtn: HTMLElement;
let qualitySelect: HTMLSelectElement;
let canvasWrapper: HTMLElement;
let previewCanvas: HTMLCanvasElement;
let undoBtn: HTMLElement;
let redoBtn: HTMLElement;
let deleteBtn: HTMLElement;

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

// --- SQLite Persistence ---
import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;

interface StreamSettings {
  platforms: string[];
  resolution: string;
  twitchIngest: string;
  kickIngest: string;
}

function getDefaultStreamSettings(): StreamSettings {
  return {
    platforms: [],
    resolution: '1080p30',
    twitchIngest: '',
    kickIngest: '',
  };
}

async function initDatabase() {
  try {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });
    
    const stored = localStorage.getItem('omnistream_db');
    if (stored) {
      try {
        const arr = JSON.parse(stored);
        const data = new Uint8Array(arr);
        db = new SQL.Database(data);
      } catch (e) {
        console.error('Failed to load stored db:', e);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    
    db.run(`
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT,
        layers TEXT
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS stream_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        platforms TEXT,
        resolution TEXT,
        twitch_ingest TEXT,
        kick_ingest TEXT
      )
    `);
    
    const result = db.exec('SELECT COUNT(*) FROM stream_settings');
    if (result.length === 0 || result[0].values[0][0] === 0) {
      const def = getDefaultStreamSettings();
      db.run(
        'INSERT INTO stream_settings (id, platforms, resolution, twitch_ingest, kick_ingest) VALUES (1, ?, ?, ?, ?)',
        [JSON.stringify(def.platforms), def.resolution, def.twitchIngest, def.kickIngest]
      );
    }
    
    console.log('SQLite database initialized');
    return true;
  } catch (e) {
    console.error('Failed to init database:', e);
    return false;
  }
}

function saveToStorage() {
  if (!db) return;
  
  try {
    db.run('DELETE FROM scenes');
    state.scenes.forEach(scene => {
      db!.run(
        'INSERT INTO scenes (id, name, layers) VALUES (?, ?, ?)',
        [scene.id, scene.name, JSON.stringify(scene.layers)]
      );
    });
    
    db!.run('UPDATE stream_settings SET platforms = ? WHERE id = 1', [
      JSON.stringify(getSelectedPlatforms()),
    ]);
    
    const data = db.export();
    const arr = Array.from(data);
    localStorage.setItem('omnistream_db', JSON.stringify(arr));
  } catch (e) {
    console.error('Failed to save:', e);
  }
}

function loadFromStorage(): boolean {
  if (!db) return false;
  
  try {
    const scenes = db.exec('SELECT id, name, layers FROM scenes');
    if (scenes.length > 0 && scenes[0].values.length > 0) {
      state.scenes = [];
      for (const row of scenes[0].values) {
        state.scenes.push({
          id: row[0] as string,
          name: row[1] as string,
          layers: JSON.parse(row[2] as string),
        });
      }
      state.activeSceneId = state.scenes[0]?.id || 'default';
      console.log('Loaded from SQLite:', state.scenes.length, 'scenes');
      return true;
    }
  } catch (e) {
    console.error('Failed to load:', e);
  }
  return false;
}

function getStreamSettings(): StreamSettings {
  if (!db) return getDefaultStreamSettings();
  
  try {
    const result = db.exec('SELECT platforms, resolution, twitch_ingest, kick_ingest FROM stream_settings WHERE id = 1');
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      return {
        platforms: JSON.parse(row[0] as string || '[]'),
        resolution: row[1] as string || '1080p30',
        twitchIngest: row[2] as string || '',
        kickIngest: row[3] as string || '',
      };
    }
  } catch (e) {
    console.error('Failed to get stream settings:', e);
  }
  return getDefaultStreamSettings();
}

function saveStreamSettings(settings: StreamSettings) {
  if (!db) return;
  
  try {
    db.run(
      'UPDATE stream_settings SET platforms = ?, resolution = ?, twitch_ingest = ?, kick_ingest = ? WHERE id = 1',
      [JSON.stringify(settings.platforms), settings.resolution, settings.twitchIngest, settings.kickIngest]
    );
    saveToStorage();
  } catch (e) {
    console.error('Failed to save stream settings:', e);
  }
}

function getSelectedPlatforms(): string[] {
  const twitchBtn = document.getElementById('toggle-twitch');
  const kickBtn = document.getElementById('toggle-kick');
  const platforms: string[] = [];
  if (twitchBtn?.classList.contains('active')) platforms.push('twitch');
  if (kickBtn?.classList.contains('active')) platforms.push('kick');
  return platforms;
}

// --- Scenes System ---
function saveCurrentSceneLayers(): LayerConfig[] {
  return state.layers.map(layer => ({
    id: layer.id,
    type: layer.type,
    active: layer.active,
    textConfig: (layer as any).textConfig,
    widgetConfig: (layer as any).widgetConfig,
    imageConfig: (layer as any).imageConfig,
    imageSrc: (layer as any).imageSrc,
    x: layer.konvaNode?.x(),
    y: layer.konvaNode?.y(),
    width: layer.konvaNode?.width(),
    height: layer.konvaNode?.height(),
    scaleX: layer.konvaNode?.scaleX(),
    scaleY: layer.konvaNode?.scaleY(),
    rotation: layer.konvaNode?.rotation(),
  }));
}

function getOrCreateScene(id: string): Scene {
  let scene = state.scenes.find(s => s.id === id);
  if (!scene) {
    scene = { id, name: id === 'default' ? 'Main' : `Scene ${state.scenes.length + 1}`, layers: [] };
    state.scenes.push(scene);
  }
  return scene;
}

function saveActiveScene() {
  if (!state.activeSceneId) return;
  const scene = getOrCreateScene(state.activeSceneId);
  scene.layers = saveCurrentSceneLayers();
}

function switchScene(sceneId: string) {
  console.log('switchScene:', sceneId, 'active:', state.activeSceneId);
  
  if (sceneId === state.activeSceneId) {
    console.log('Same scene, skipping');
    return;
  }
   
  saveActiveScene();
   
  const targetScene = state.scenes.find(s => s.id === sceneId);
  if (!targetScene) {
    console.log('Target scene not found');
    return;
  }
  
  if (!targetScene.layers) {
    targetScene.layers = [];
  }
   
  state.activeSceneId = sceneId;
  
  state.layers.forEach(layer => layer.konvaNode?.destroy());
  state.layers = [];
  state.transformer.nodes([]);
  
  console.log('Loading', targetScene.layers.length, 'layers for scene:', sceneId);
   
  targetScene.layers.forEach(layerConfig => {
    const config = layerConfig as any;
    const id = config.id;
    const type = config.type;
    let node: any = null;
    
    if (type === 'text' && config.textConfig) {
      node = new Konva.Text({
        x: config.x || STAGE_WIDTH / 2,
        y: config.y || STAGE_HEIGHT / 2,
        text: config.textConfig.text,
        fontSize: config.textConfig.fontSize,
        fontFamily: config.textConfig.fontFamily || 'Inter, Arial, sans-serif',
        fill: config.textConfig.color,
        draggable: true,
        scaleX: config.scaleX || 1,
        scaleY: config.scaleY || 1,
        rotation: config.rotation || 0,
      });
      node.offsetX(node.width() / 2);
      node.offsetY(node.height() / 2);
    } else if (type.startsWith('widget-') && config.widgetConfig) {
      const wc = config.widgetConfig;
      const labelNode = new Konva.Label({
        x: config.x || STAGE_WIDTH / 2,
        y: config.y || STAGE_HEIGHT / 2,
        draggable: true,
        scaleX: config.scaleX || 1,
        scaleY: config.scaleY || 1,
        rotation: config.rotation || 0,
      });
      if (wc.bgShape !== 'none') {
        labelNode.add(new Konva.Tag({
          fill: wc.bgColor,
          cornerRadius: wc.bgShape === 'pill' ? 30 : 0,
          lineJoin: 'round',
        }));
      }
      const txt = new Konva.Text({
        text: getWidgetInitialText(wc.type, wc.configVal),
        fontSize: wc.type === 'countdown' ? 72 : 48,
        fontFamily: wc.font + ', Inter, Arial, sans-serif',
        fontStyle: 'bold',
        fill: wc.color,
        padding: 20,
      });
      labelNode.add(txt);
      labelNode.offsetX(labelNode.width() / 2);
      labelNode.offsetY(labelNode.height() / 2);
      node = labelNode;
    } else if (type === 'image' || type === 'html') {
      node = new Konva.Image({
        x: config.x || STAGE_WIDTH / 2,
        y: config.y || STAGE_HEIGHT / 2,
        draggable: true,
        width: config.width || undefined,
        height: config.height || undefined,
        scaleX: config.scaleX ?? 1,
        scaleY: config.scaleY ?? 1,
        rotation: config.rotation || 0,
      });
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = (config as any).imageSrc || '';
      node.image(img);
    }
    
    if (node) {
      node.on('click tap', () => selectLayer(id));
      state.konvaLayer.add(node);
      
      const layer: any = { id, type, konvaNode: node, active: config.active };
      if (config.textConfig) layer.textConfig = config.textConfig;
      if (config.widgetConfig) layer.widgetConfig = config.widgetConfig;
      if (config.imageConfig) layer.imageConfig = config.imageConfig;
      state.layers.push(layer);
    }
  });
  
  state.konvaLayer.batchDraw();
  renderLayersList();
  renderScenesList();
  updatePreview();
  saveToStorage();
}

function getWidgetInitialText(type: string, configVal?: number): string {
  if (type === 'clock') return new Date().toLocaleTimeString();
  if (type === 'countdown') return `${configVal || 5}:00`;
  if (type === 'twitch-viewers') return 'Twitch: 0';
  if (type === 'kick-viewers') return 'Kick: 0';
  if (type === 'alerts') return 'Waiting for alerts...';
  return 'Widget';
}

function addNewScene(name?: string) {
  const id = 'scene_' + Date.now();
  const sceneName = name || `Scene ${state.scenes.length + 1}`;
  state.scenes.push({ id, name: sceneName, layers: [] });
  renderScenesList();
  saveToStorage();
}

function deleteScene(sceneId: string) {
  if (sceneId === 'default') return;
  if (state.scenes.length <= 1) return;
  
  state.scenes = state.scenes.filter(s => s.id !== sceneId);
  if (state.activeSceneId === sceneId) {
    state.activeSceneId = state.scenes[0]?.id || 'default';
    switchScene(state.activeSceneId);
  }
  renderScenesList();
  saveToStorage();
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
  
  const scale = Math.min(availableWidth / STAGE_WIDTH, availableHeight / STAGE_HEIGHT);
  
  const width = STAGE_WIDTH * scale;
  const height = STAGE_HEIGHT * scale;
  
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  
  if (state.konvaStage) {
    state.konvaStage.width(width);
    state.konvaStage.height(height);
    state.konvaStage.scale({ x: scale, y: scale });
  }
  
  console.log('Canvas resized:', width, 'x', height, 'scale:', scale);
}

// --- Initialize Konva ---
function initKonva() {
  if (state.scenes.length === 0) {
    state.scenes.push({ id: 'default', name: 'Main', layers: [] });
    state.activeSceneId = 'default';
  }
  
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
      renderLayersList();
    }
  });
  
  // Save state on transform end
  state.transformer.on('transformend', () => {
    saveState();
    saveToStorage();
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
    const layer: any = {
      id,
      type: 'image',
      konvaNode: konvaImage,
      active: true,
      imageConfig: { opacity: 1, scaleX: 1, scaleY: 1 },
    };
    layer.imageSrc = imageSrc;
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
    renderLayersList();
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
    
    const layer: any = {
      id,
      type: 'html',
      konvaNode: konvaImage,
      active: true,
      imageConfig: { opacity: 1, scaleX: 1, scaleY: 1 },
    };
    layer.imageSrc = url;
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
    textConfig: { text, fontSize, color, fontFamily: 'Inter' },
  };
  state.layers.push(layer);
  
  selectLayer(id);
  renderLayersList();
  updatePreview();
  console.log('Text layer added:', id);
}

// --- Native Widget Layer ---
function addWidgetLayer(type: string, configVal: number, color: string, font: string, bgColor: string, bgShape: string) {
  if (!state.konvaLayer) return;
  
  const id = Date.now().toString();
  let initialText = 'Widget';
  let fontSize = 48;
  
  if (type === 'clock') {
    initialText = new Date().toLocaleTimeString();
  } else if (type === 'countdown') {
    initialText = `${configVal}:00`;
    fontSize = 72;
  } else if (type === 'twitch-viewers') {
    initialText = 'Twitch: 0';
  } else if (type === 'kick-viewers') {
    initialText = 'Kick: 0';
  } else if (type === 'alerts') {
    initialText = 'Waiting for alerts...';
  }
  
  const konvaLabel = new Konva.Label({
    x: STAGE_WIDTH / 2,
    y: STAGE_HEIGHT / 2,
    draggable: true,
  });
  
  if (bgShape !== 'none') {
    konvaLabel.add(new Konva.Tag({
      fill: bgColor,
      cornerRadius: bgShape === 'pill' ? 30 : 0,
      lineJoin: 'round',
    }));
  }
  
  const konvaText = new Konva.Text({
    text: initialText,
    fontSize: fontSize,
    fontFamily: font + ', Inter, Arial, sans-serif',
    fontStyle: 'bold',
    fill: color,
    padding: 20,
  });
  
  konvaLabel.add(konvaText);
  
  konvaLabel.offsetX(konvaLabel.width() / 2);
  konvaLabel.offsetY(konvaLabel.height() / 2);
  
  konvaLabel.on('click tap', () => selectLayer(id));
  state.konvaLayer.add(konvaLabel);
  
  const layer = {
    id,
    type: `widget-${type}`,
    konvaNode: konvaLabel,
    active: true,
    widgetConfig: { type, configVal, color, font, bgColor, bgShape, startTime: Date.now() },
  };
  
  state.layers.push(layer);
  selectLayer(id);
  renderLayersList();
  updatePreview();
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

function renderScenesList() {
  const scenesList = document.getElementById('scenes-list');
  if (!scenesList) return;
  
  scenesList.innerHTML = '';
  
  state.scenes.forEach((scene, index) => {
    const div = document.createElement('div');
    div.className = 'scene-item';
    if (scene.id === state.activeSceneId) {
      div.classList.add('active');
    }
    div.innerHTML = `
      <span class="scene-name" style="cursor: pointer; flex: 1;">${scene.name}</span>
      <button class="scene-settings-btn" data-id="${scene.id}" title="Edit Scene">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
      </button>
      <button class="scene-add-btn" data-action="switch" data-id="${scene.id}" title="Switch to">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
      <button class="scene-delete-btn" data-id="${scene.id}" title="Delete" ${scene.id === 'default' ? 'disabled' : ''}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;
    div.querySelector('.scene-add-btn')?.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
      if (id) switchScene(id);
    });
    div.querySelector('.scene-delete-btn')?.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
      if (id) deleteScene(id);
    });
    div.querySelector('.scene-settings-btn')?.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
      if (id) openSceneRenameDialog(id);
    });
    scenesList.appendChild(div);
  });
}

function openSceneRenameDialog(sceneId: string) {
  const scene = state.scenes.find(s => s.id === sceneId);
  if (!scene) return;
  
  const existing = document.getElementById('scene-rename-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'scene-rename-dialog';
  dialog.className = 'dialog-overlay';
  dialog.innerHTML = `
    <div class="dialog" style="max-width: 300px;">
      <div class="dialog-header">
        <span>Scene Settings</span>
        <button class="dialog-close" onclick="this.closest('.dialog-overlay').remove()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="dialog-content" style="padding: 20px;">
        <div class="form-group">
          <label>Scene Name</label>
          <input type="text" id="scene-rename-input" value="${scene.name}" style="width: 100%; padding: 10px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);" />
        </div>
      </div>
      <div style="padding: 0 20px 20px;">
        <button class="dialog-action primary" id="save-scene-rename-btn" style="width: 100%;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
  
  document.getElementById('save-scene-rename-btn')?.addEventListener('click', () => {
    const input = document.getElementById('scene-rename-input') as HTMLInputElement;
    if (input && input.value.trim()) {
      scene.name = input.value.trim();
      renderScenesList();
      saveToStorage();
    }
    dialog.remove();
  });
}

function initScenesUI() {
  const addSceneBtn = document.getElementById('add-scene-btn');
  console.log('add-scene-btn found:', !!addSceneBtn);
  if (addSceneBtn) {
    addSceneBtn.addEventListener('click', () => {
      console.log('Add scene button clicked');
      addNewScene();
    });
  }
  renderScenesList();
}

function renderLayersList() {
  layersList.innerHTML = '';
  
  const selectedNodes = state.transformer.nodes();
  const selectedNode = selectedNodes.length > 0 ? selectedNodes[0] : null;
  
  state.layers.forEach((layer, index) => {
    const div = document.createElement('div');
    div.className = 'layer-item';
    if (selectedNode && layer.konvaNode === selectedNode) {
      div.classList.add('selected');
    }
    div.innerHTML = `
      <span class="layer-name" style="cursor: pointer; flex: 1;">${layer.type} #${index + 1}</span>
      <button class="edit-btn" data-id="${layer.id}" title="Edit Settings">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="delete-btn" data-id="${layer.id}" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    `;
    div.querySelector('.layer-name')?.addEventListener('click', () => {
      selectLayer(layer.id);
    });
    div.querySelector('.edit-btn')?.addEventListener('click', () => {
      openEditDialog(layer.id);
    });
    div.querySelector('.delete-btn')?.addEventListener('click', () => {
      deleteLayer(layer.id);
    });
    layersList.appendChild(div);
  });
  saveToStorage();
}

// --- GIF Overlay for Countdown End ---
const activeGifOverlays = new Map<string, { node: Konva.Image; img: HTMLImageElement }>();

function showGifOverlay(layerId: string, gifPath: string) {
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer || !state.konvaLayer) return;
  
  // Position GIF at the same position as the countdown widget
  const pos = layer.konvaNode.position();
  
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = 'file://' + gifPath;
  
  img.onload = () => {
    // Scale to reasonable size
    const scale = Math.min(300 / img.width, 200 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    
    const gifNode = new Konva.Image({
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      image: img,
      draggable: false,
    });
    
    gifNode.offsetX(w / 2);
    gifNode.offsetY(h / 2);
    
    state.konvaLayer.add(gifNode);
    state.konvaLayer.batchDraw();
    
    // Store to clean up later
    activeGifOverlays.set(layerId, { node: gifNode, img });
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      const existing = activeGifOverlays.get(layerId);
      if (existing) {
        existing.node.destroy();
        activeGifOverlays.delete(layerId);
        state.konvaLayer.batchDraw();
      }
    }, 3000);
  };
  
  img.onerror = () => {
    console.error('Failed to load GIF:', gifPath);
  };
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

// --- Edit Dialog for Layer Settings ---
const editDialog = document.createElement('div');
editDialog.className = 'dialog-overlay hidden';
editDialog.id = 'edit-layer-dialog';
editDialog.innerHTML = `
  <div class="dialog">
    <div class="dialog-header">
      <span id="edit-dialog-title">Edit Layer</span>
      <button class="dialog-close" id="edit-dialog-close">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="dialog-content" id="edit-dialog-content" style="padding: 20px;">
      <!-- Dynamically filled based on layer type -->
    </div>
    <div style="padding: 0 20px 20px;">
      <button class="dialog-action primary" id="save-edit-btn" style="width: 100%;">Save Changes</button>
    </div>
  </div>
`;
document.body.appendChild(editDialog);

let editingLayerId: string | null = null;
let editingLayerType: string | null = null;

function openEditDialog(id: string) {
  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;
  
  editingLayerId = id;
  editingLayerType = layer.type;
  
  const title = document.getElementById('edit-dialog-title')!;
  const content = document.getElementById('edit-dialog-content')!;
  const node = layer.konvaNode;
  const textConfig = (layer as any).textConfig;
  const widgetConfig = (layer as any).widgetConfig;
  
  if (layer.type === 'text' && node instanceof Konva.Text) {
    const txt = textConfig?.text ?? node.text();
    const fs = textConfig?.fontSize ?? node.fontSize();
    const col = textConfig?.color ?? node.fill();
    title.textContent = 'Edit Text';
    content.innerHTML = `
      <div class="form-group">
        <label>Text</label>
        <input type="text" id="edit-text-input" value="${txt}" />
      </div>
      <div class="form-group">
        <label>Font Size</label>
        <select id="edit-text-font-size">
          <option value="24" ${fs === 24 ? 'selected' : ''}>24px</option>
          <option value="36" ${fs === 36 ? 'selected' : ''}>36px</option>
          <option value="48" ${fs === 48 ? 'selected' : ''}>48px</option>
          <option value="60" ${fs === 60 ? 'selected' : ''}>60px</option>
          <option value="72" ${fs === 72 ? 'selected' : ''}>72px</option>
          <option value="96" ${fs === 96 ? 'selected' : ''}>96px</option>
        </select>
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="edit-text-color" value="${col}" />
      </div>
    `;
  } else if (layer.type.startsWith('widget-')) {
    const widgetType = widgetConfig?.type ?? layer.type.replace('widget-', '');
    const labelNode = node as Konva.Label;
    
    title.textContent = 'Edit Widget';
    content.innerHTML = `
      <div class="form-group">
        <label>Widget Type</label>
        <select id="edit-widget-type">
          <option value="clock" ${widgetType === 'clock' ? 'selected' : ''}>Digital Clock</option>
          <option value="countdown" ${widgetType === 'countdown' ? 'selected' : ''}>Countdown Timer</option>
          <option value="twitch-viewers" ${widgetType === 'twitch-viewers' ? 'selected' : ''}>Twitch Viewers</option>
          <option value="kick-viewers" ${widgetType === 'kick-viewers' ? 'selected' : ''}>Kick Viewers</option>
          <option value="alerts" ${widgetType === 'alerts' ? 'selected' : ''}>Event Alerts</option>
        </select>
      </div>
      <div class="form-group" id="edit-widget-config-group" style="display: ${widgetType === 'countdown' ? 'block' : 'none'};">
        <label>Minutes</label>
        <input type="number" id="edit-widget-config-input" value="${widgetConfig?.configVal || 5}" min="1" />
      </div>
      <div class="form-group" id="edit-widget-audio-group" style="display: ${widgetType === 'countdown' ? 'block' : 'none'};">
        <label>Audio (play at end)</label>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="select-audio-btn" style="flex: 1; padding: 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; color: white; cursor: pointer;">
            ${widgetConfig?.audioSrc ? 'Change Audio' : 'Select Audio'}
          </button>
          <span id="audio-file-name" style="flex: 1; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center;">
            ${widgetConfig?.audioSrc ? widgetConfig.audioSrc.split('/').pop() : 'No file'}
          </span>
        </div>
        <input type="hidden" id="edit-widget-audio-src" value="${widgetConfig?.audioSrc || ''}" />
      </div>
      <div class="form-group" id="edit-widget-gif-group" style="display: ${widgetType === 'countdown' ? 'block' : 'none'};">
        <label>GIF Animation (play at end)</label>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="select-gif-btn" style="flex: 1; padding: 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; color: white; cursor: pointer;">
            ${widgetConfig?.gifSrc ? 'Change GIF' : 'Select GIF'}
          </button>
          <span id="gif-file-name" style="flex: 1; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center;">
            ${widgetConfig?.gifSrc ? widgetConfig.gifSrc.split('/').pop() : 'No file'}
          </span>
        </div>
        <input type="hidden" id="edit-widget-gif-src" value="${widgetConfig?.gifSrc || ''}" />
      </div>
      <div class="form-group">
        <label>Font Family</label>
        <select id="edit-widget-font">
          <option value="Inter" ${widgetConfig?.font === 'Inter' ? 'selected' : ''}>Inter</option>
          <option value="Roboto" ${widgetConfig?.font === 'Roboto' ? 'selected' : ''}>Roboto</option>
          <option value="Montserrat" ${widgetConfig?.font === 'Montserrat' ? 'selected' : ''}>Montserrat</option>
          <option value="Oswald" ${widgetConfig?.font === 'Oswald' ? 'selected' : ''}>Oswald</option>
          <option value="Pacifico" ${widgetConfig?.font === 'Pacifico' ? 'selected' : ''}>Pacifico</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Text Color</label>
          <input type="color" id="edit-widget-color" value="${widgetConfig?.color || '#00fa9a'}" />
        </div>
        <div class="form-group">
          <label>Background</label>
          <input type="color" id="edit-widget-bg-color" value="${widgetConfig?.bgColor || '#1a1a1c'}" />
        </div>
      </div>
      <div class="form-group">
        <label>Background Shape</label>
        <select id="edit-widget-bg-shape">
          <option value="none" ${widgetConfig?.bgShape === 'none' ? 'selected' : ''}>None (Transparent)</option>
          <option value="pill" ${widgetConfig?.bgShape === 'pill' ? 'selected' : ''}>Pill (Rounded)</option>
          <option value="rect" ${widgetConfig?.bgShape === 'rect' ? 'selected' : ''}>Rectangle</option>
        </select>
      </div>
    `;
    
    setTimeout(() => {
      const typeSelect = document.getElementById('edit-widget-type') as HTMLSelectElement;
      const configGroup = document.getElementById('edit-widget-config-group')!;
      const audioGroup = document.getElementById('edit-widget-audio-group')!;
      const gifGroup = document.getElementById('edit-widget-gif-group')!;
      if (typeSelect) {
        typeSelect.addEventListener('change', () => {
          const isCountdown = typeSelect.value === 'countdown';
          configGroup.style.display = isCountdown ? 'block' : 'none';
          audioGroup.style.display = isCountdown ? 'block' : 'none';
          gifGroup.style.display = isCountdown ? 'block' : 'none';
        });
      }
      
      // File picker for audio
      document.getElementById('select-audio-btn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*,.mp3,.wav';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) {
            const audioInput = document.getElementById('edit-widget-audio-src') as HTMLInputElement;
            const fileName = document.getElementById('audio-file-name');
            audioInput.value = file.path;
            if (fileName) fileName.textContent = file.name;
            document.getElementById('select-audio-btn')!.textContent = 'Change Audio';
          }
        };
        input.click();
      });
      
      // File picker for GIF
      document.getElementById('select-gif-btn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/gif,.gif';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) {
            const gifInput = document.getElementById('edit-widget-gif-src') as HTMLInputElement;
            const fileName = document.getElementById('gif-file-name');
            gifInput.value = file.path;
            if (fileName) fileName.textContent = file.name;
            document.getElementById('select-gif-btn')!.textContent = 'Change GIF';
          }
        };
        input.click();
      });
    }, 0);
  } else if (layer.type === 'image' || layer.type === 'html') {
    title.textContent = 'Edit Image/HTML';
    content.innerHTML = `
      <div class="form-group">
        <label>Opacity</label>
        <input type="range" id="edit-opacity" value="${(node.opacity() || 1) * 100}" min="0" max="100" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Scale X</label>
          <input type="number" id="edit-scale-x" value="${node.scaleX()}" step="0.1" min="0.1" />
        </div>
        <div class="form-group">
          <label>Scale Y</label>
          <input type="number" id="edit-scale-y" value="${node.scaleY()}" step="0.1" min="0.1" />
        </div>
      </div>
    `;
  }
  
  editDialog.classList.remove('hidden');
  editDialog.style.display = 'flex';
}

function closeEditDialog() {
  editDialog.classList.add('hidden');
  editDialog.style.display = 'none';
  editingLayerId = null;
  editingLayerType = null;
}

function saveEditDialog() {
  if (!editingLayerId) return;
  
  const layer = state.layers.find(l => l.id === editingLayerId);
  if (!layer) return;
  
  saveState();
  const node = layer.konvaNode;
  
  if (layer.type === 'text' && node instanceof Konva.Text) {
    const textInput = document.getElementById('edit-text-input') as HTMLInputElement;
    const fontSizeSelect = document.getElementById('edit-text-font-size') as HTMLSelectElement;
    const colorInput = document.getElementById('edit-text-color') as HTMLInputElement;
    
    const text = textInput?.value || '';
    const fontSize = parseInt(fontSizeSelect?.value) || 36;
    const color = colorInput?.value || '#ffffff';
    
    node.text(text);
    node.fontSize(fontSize);
    node.fill(color);
    
    (layer as any).textConfig = { text, fontSize, color, fontFamily: 'Inter' };
  } else if (layer.type.startsWith('widget-')) {
    const typeSelect = document.getElementById('edit-widget-type') as HTMLSelectElement;
    const configInput = document.getElementById('edit-widget-config-input') as HTMLInputElement;
    const fontSelect = document.getElementById('edit-widget-font') as HTMLSelectElement;
    const colorInput = document.getElementById('edit-widget-color') as HTMLInputElement;
    const bgColorInput = document.getElementById('edit-widget-bg-color') as HTMLInputElement;
    const bgShapeSelect = document.getElementById('edit-widget-bg-shape') as HTMLSelectElement;
    
    const audioSrcInput = document.getElementById('edit-widget-audio-src') as HTMLInputElement;
    const gifSrcInput = document.getElementById('edit-widget-gif-src') as HTMLInputElement;
    
    layer.widgetConfig = {
      ...layer.widgetConfig,
      type: typeSelect?.value || 'clock',
      configVal: parseFloat(configInput?.value) || 5,
      font: fontSelect?.value || 'Inter',
      color: colorInput?.value || '#00fa9a',
      bgColor: bgColorInput?.value || '#1a1a1c',
      bgShape: bgShapeSelect?.value || 'pill',
      audioSrc: audioSrcInput?.value || '',
      gifSrc: gifSrcInput?.value || '',
    };
    
    const labelNode = node as Konva.Label;
    const tagNode = labelNode.getTag();
    const textNode = labelNode.getText();
    if (tagNode) {
      tagNode.fill(layer.widgetConfig.bgColor);
      tagNode.cornerRadius(layer.widgetConfig.bgShape === 'pill' ? 30 : 0);
    }
    if (textNode) {
      textNode.fontFamily((layer.widgetConfig.font || 'Inter') + ', Inter, Arial, sans-serif');
      textNode.fill(layer.widgetConfig.color || '#00fa9a');
    }
  } else if (layer.type === 'image' || layer.type === 'html') {
    const opacityInput = document.getElementById('edit-opacity') as HTMLInputElement;
    const scaleXInput = document.getElementById('edit-scale-x') as HTMLInputElement;
    const scaleYInput = document.getElementById('edit-scale-y') as HTMLInputElement;
    
    if (opacityInput) node.opacity(parseInt(opacityInput.value) / 100);
    if (scaleXInput) node.scaleX(parseFloat(scaleXInput.value));
    if (scaleYInput) node.scaleY(parseFloat(scaleYInput.value));
    
    (layer as any).imageConfig = {
      opacity: parseInt(opacityInput?.value) / 100 || 1,
      scaleX: parseFloat(scaleXInput?.value) || 1,
      scaleY: parseFloat(scaleYInput?.value) || 1,
    };
  }
  
  state.konvaLayer.batchDraw();
  updatePreview();
  closeEditDialog();
  saveToStorage();
}

// Edit dialog event listeners
document.getElementById('edit-dialog-close')?.addEventListener('click', closeEditDialog);
document.getElementById('save-edit-btn')?.addEventListener('click', saveEditDialog);
editDialog.addEventListener('click', (e) => {
  if (e.target === editDialog) closeEditDialog();
});

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
// Now set up in DOMContentLoaded after elements exist

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

// Widgets tab
const widgetTypeSelect = document.getElementById('widget-type-select') as HTMLSelectElement;
const widgetConfigGroup = document.getElementById('widget-config-group') as HTMLDivElement;
const widgetConfigInput = document.getElementById('widget-config-input') as HTMLInputElement;
const widgetConfigLabel = document.getElementById('widget-config-label') as HTMLLabelElement;
const widgetColor = document.getElementById('widget-color') as HTMLInputElement;
const widgetBgColor = document.getElementById('widget-bg-color') as HTMLInputElement;
const widgetFont = document.getElementById('widget-font') as HTMLSelectElement;
const widgetBgShape = document.getElementById('widget-bg-shape') as HTMLSelectElement;
const addWidgetBtn = document.getElementById('add-widget-btn') as HTMLButtonElement;

widgetTypeSelect?.addEventListener('change', () => {
  if (widgetTypeSelect.value === 'countdown') {
    widgetConfigGroup.style.display = 'block';
    widgetConfigLabel.textContent = 'Minutes';
  } else {
    widgetConfigGroup.style.display = 'none';
  }
});

addWidgetBtn?.addEventListener('click', () => {
  const type = widgetTypeSelect.value;
  const configVal = parseFloat(widgetConfigInput.value) || 5;
  const color = widgetColor.value;
  const font = widgetFont.value;
  const bgColor = widgetBgColor.value;
  const bgShape = widgetBgShape.value;
  
  saveState();
  addWidgetLayer(type, configVal, color, font, bgColor, bgShape);
  closeDialog();
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
// Now set up in DOMContentLoaded

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

// --- Mediabunny Stream Capture ---
let mediaOutput: Output | null = null;
let captureInterval: number | null = null;
let frameCount = 0;
let streamReady = false;

let mediaRecorder: MediaRecorder | null = null;

async function startCapture() {
  if (!state.konvaStage) return;
  
  try {
    // We need a unified canvas to record from, because Konva uses multiple canvases internally
    const is1080 = (document.getElementById('quality') as HTMLSelectElement)?.value.includes('1080') ?? true;
    const width = is1080 ? 1920 : 1280;
    const height = is1080 ? 1080 : 720;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d', { alpha: false })!;
    
    // Fill background so it's not transparent
    tempCtx.fillStyle = '#000000';
    tempCtx.fillRect(0, 0, width, height);
    
    // Capture stream from the temp canvas at 30 FPS
    const canvasStream = tempCanvas.captureStream(30);
    
    // Try to find the best supported MIME type
    let mimeType = '';
    const types = [
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    
    console.log('Starting MediaRecorder with mimeType:', mimeType, 'Resolution:', width, 'x', height);
    mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: 4500000 // 4.5 Mbps
    });
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && state.ws?.readyState === WebSocket.OPEN) {
        // Send WebM blob directly to Node.js server
        e.data.arrayBuffer().then(buffer => {
          state.ws?.send(new Uint8Array(buffer));
        });
      }
    };
    
    // Request data every 1000ms
    mediaRecorder.start(1000);
    streamReady = true;
    console.log('MediaRecorder capture started');
    
    // Continuously draw Konva stage to the temp canvas using requestAnimationFrame
    let lastTime = performance.now();
    const interval = 1000 / 30;
    
    const captureFrame = (currentTime: number) => {
      if (!streamReady || !state.konvaStage) return;
      captureInterval = requestAnimationFrame(captureFrame);
      
      const delta = currentTime - lastTime;
      if (delta > interval) {
        lastTime = currentTime - (delta % interval);
        try {
          tempCtx.fillStyle = '#000000';
          tempCtx.fillRect(0, 0, width, height);
          
          const konvaCanvas = state.konvaStage.content.querySelector('canvas');
          if (konvaCanvas) {
            tempCtx.drawImage(konvaCanvas, 0, 0, width, height);
          } else {
            const compositeCanvas = state.konvaStage.toCanvas({ pixelRatio: width / state.konvaStage.width() });
            tempCtx.drawImage(compositeCanvas, 0, 0, width, height);
          }
        } catch (e) {
          console.error('Frame copy error:', e);
        }
      }
    };
    
    captureInterval = requestAnimationFrame(captureFrame);
    
  } catch (e) {
    console.error('MediaRecorder failed:', e);
  }
}

function stopCapture() {
  if (captureInterval) {
    cancelAnimationFrame(captureInterval);
    captureInterval = null;
  }
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
  
  streamReady = false;
  console.log('Capture stopped');
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
  
  let needsDraw = false;
  
  // Update native widgets
  state.layers.forEach(layer => {
    if (!layer.widgetConfig) return;
    const wType = layer.widgetConfig.type;
    const node = layer.konvaNode as Konva.Label;
    const textNode = node.getText();
    
    if (wType === 'twitch-viewers' && type === 'twitch-viewers') {
      textNode.text(`Twitch: ${data.count || 0}`);
      needsDraw = true;
    } else if (wType === 'kick-viewers' && type === 'kick-viewers') {
      textNode.text(`Kick: ${data.count || 0}`);
      needsDraw = true;
    } else if (wType === 'alerts' && (type === 'follow' || type === 'sub')) {
      textNode.text(`${data.user || 'Someone'} just ${type}ed!`);
      needsDraw = true;
      // Reset after 5 seconds
      setTimeout(() => {
        if (state.layers.includes(layer)) {
          textNode.text('Waiting for alerts...');
          state.konvaLayer.batchDraw();
        }
      }, 5000);
    }
  });
  
  if (needsDraw && state.konvaLayer) {
    state.konvaLayer.batchDraw();
  }
  
  // Update HTML overlays
  htmlOverlayLayers.forEach((overlay, id) => {
    updateHtmlOverlayData(id, { type, ...data });
  });
}

// --- Start/Stop Stream ---
// Now set up in DOMContentLoaded

function showNoPlatformDialog() {
  const existing = document.getElementById('no-platform-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'no-platform-dialog';
  dialog.className = 'dialog-overlay';
  dialog.innerHTML = `
    <div class="dialog" style="max-width: 350px;">
      <div class="dialog-header">
        <span>Select a Platform</span>
        <button class="dialog-close" onclick="this.closest('.dialog-overlay').remove()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="dialog-content" style="padding: 20px; text-align: center;">
        <p style="margin-bottom: 15px; color: var(--text-secondary);">Please select at least one streaming platform (Twitch or Kick) before going live.</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button class="dialog-action" onclick="document.getElementById('toggle-twitch').click(); this.closest('.dialog-overlay').remove()" style="flex: 1;">Select Twitch</button>
          <button class="dialog-action" onclick="document.getElementById('toggle-kick').click(); this.closest('.dialog-overlay').remove()" style="flex: 1;">Select Kick</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
}

function startStream() {
  if (state.isLive) return;
  
  const platforms = getSelectedPlatforms();
  if (platforms.length === 0) {
    showNoPlatformDialog();
    return;
  }
  
  // Save stream settings
  const ingestSelect = document.getElementById('ingest') as HTMLSelectElement;
  const settings: StreamSettings = {
    platforms,
    resolution: qualitySelect.value,
    twitchIngest: ingestSelect?.value || '',
    kickIngest: '',
  };
  saveStreamSettings(settings);
  
  connectWebSocket();
  
  new Promise<void>((resolve) => {
    if (state.ws?.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      state.ws!.onopen = () => resolve();
    }
  }).then(() => {
    const twitchBtn = document.getElementById('toggle-twitch');
    const kickBtn = document.getElementById('toggle-kick');
    
    const config = {
      twitchKey: twitchBtn?.classList.contains('active') ? 'using_env' : null,
      kickUrl: kickBtn?.classList.contains('active') ? 'using_env' : null,
      bitrate: qualitySelect.value === '1080p60' ? '6000k' : '4500k',
      codec: 'avc1.42001E',
    };
    
    console.log('Config:', config);
    state.ws?.send(JSON.stringify(config));
    startCapture();
    
    state.isLive = true;
    actionBtn.textContent = 'LIVE';
    actionBtn.classList.add('live');
    (stopBtn as HTMLButtonElement).disabled = false;
  });
}

function stopStream() {
  if (!state.isLive) return;
  
  stopCapture();
  state.ws?.close();
  
  state.isLive = false;
  actionBtn.textContent = 'GO LIVE';
  actionBtn.classList.remove('live');
  (stopBtn as HTMLButtonElement).disabled = true;
}

// --- Preview Update Loop ---
function updateTimeWidgets() {
  const now = Date.now();
  let needsDraw = false;
  
  state.layers.forEach(layer => {
    if (!layer.widgetConfig) return;
    const { type, configVal, startTime } = layer.widgetConfig;
    const node = layer.konvaNode as Konva.Label;
    const textNode = node.getText();
    
    if (type === 'clock') {
      const newText = new Date().toLocaleTimeString();
      if (textNode.text() !== newText) {
        textNode.text(newText);
        needsDraw = true;
      }
    } else if (type === 'countdown') {
      const elapsed = now - startTime;
      const totalMs = configVal * 60 * 1000;
      const remainingMs = Math.max(0, totalMs - elapsed);
      const mins = Math.floor(remainingMs / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);
      const newText = `${mins}:${secs.toString().padStart(2, '0')}`;
      if (textNode.text() !== newText) {
        textNode.text(newText);
        needsDraw = true;
      }
      
      // Check if countdown just ended (was above 0, now at 0)
      const prevElapsed = elapsed - 100;
      const prevRemaining = Math.max(0, totalMs - prevElapsed);
      const prevMins = Math.floor(prevRemaining / 60000);
      const prevSecs = Math.floor((prevRemaining % 60000) / 1000);
      
      if (prevMins > 0 || prevSecs > 0) {
        if (mins === 0 && secs === 0) {
          // Countdown ended! Play audio and show GIF
          const wc = layer.widgetConfig;
          
          // Play audio
          if (wc.audioSrc) {
            try {
              const audio = new Audio();
              audio.src = 'file://' + wc.audioSrc;
              audio.volume = 1;
              audio.play().catch(e => console.error('Audio play failed:', e));
            } catch (e) {
              console.error('Audio error:', e);
            }
          }
          
          // Show GIF
          if (wc.gifSrc) {
            showGifOverlay(layer.id, wc.gifSrc);
          }
        }
      }
    }
  });
  
  if (needsDraw && state.konvaLayer) {
    state.konvaLayer.batchDraw();
  }
}

function startPreviewLoop() {
  setInterval(() => {
    updateTimeWidgets();
    updatePreview();
  }, 100); // 10 FPS preview update
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('DOM loaded, initializing...');
    
    // Get DOM elements after DOM is ready
    layersList = document.getElementById('layers-list')!;
    actionBtn = document.getElementById('action-btn')!;
    stopBtn = document.getElementById('stop-btn')!;
    addLayerBtn = document.getElementById('add-layer-btn')!;
    qualitySelect = document.getElementById('quality') as HTMLSelectElement;
    canvasWrapper = document.getElementById('canvas-wrapper')!;
    previewCanvas = document.createElement('canvas');
    undoBtn = document.getElementById('undo-btn')!;
    redoBtn = document.getElementById('redo-btn')!;
    deleteBtn = document.getElementById('delete-btn')!;
    
    // Set up layer add button
    addLayerBtn?.addEventListener('click', () => {
      console.log('Add layer button clicked');
      openDialog();
    });
    
    // Set up undo/redo/delete buttons
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);
    deleteBtn?.addEventListener('click', deleteSelectedLayer);
    
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
    
    // Stream control buttons
    actionBtn?.addEventListener('click', startStream);
    stopBtn?.addEventListener('click', stopStream);
    
    // Initialize database
    const dbInited = await initDatabase();
    if (dbInited) {
      // Load stream settings
      const settings = getStreamSettings();
      
      // Apply platform selection
      if (settings.platforms.includes('twitch')) {
        twitchBtn?.classList.add('active');
      }
      if (settings.platforms.includes('kick')) {
        kickBtn?.classList.add('active');
      }
      
      // Apply resolution
      if (settings.resolution) {
        qualitySelect.value = settings.resolution;
      }
      
      // Apply ingest
      const ingestSelect = document.getElementById('ingest') as HTMLSelectElement;
      if (ingestSelect && settings.twitchIngest) {
        ingestSelect.value = settings.twitchIngest;
      }
      
      console.log('Loaded stream settings:', settings);
    }
    
    // Try load saved scenes from SQLite
    console.log('Loading scenes from storage, db exists:', !!db);
    const hasStored = loadFromStorage();
    console.log('hasStored:', hasStored, 'scenes:', state.scenes.length);
    if (hasStored && state.scenes.length > 0) {
      console.log('Loaded saved scenes from SQLite:', state.scenes.length);
    } else {
      state.scenes = [{ id: 'default', name: 'Main', layers: [] }];
      state.activeSceneId = 'default';
      console.log('Created new default scene');
    }
    
    initKonva();
    initScenesUI();
    renderScenesList();
    
    // After Konva init, load layers for active scene
    const activeScene = state.scenes.find(s => s.id === state.activeSceneId);
    console.log('Active scene:', state.activeSceneId, 'layers:', activeScene?.layers?.length || 0);
    if (activeScene && activeScene.layers && activeScene.layers.length > 0) {
      switchScene(state.activeSceneId);
    }
    
    startPreviewLoop();
    console.log('OmniStream Studio initialized');
  } catch (e) {
    console.error('Init error:', e);
  }
});

export {};