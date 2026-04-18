const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// =======================
// JSON File Database
// =======================
const JSON_PATH = path.join(__dirname, 'omnistream.json');

let data = {
  scenes: [],
  settings: { platforms: [], resolution: '1080p30', twitchIngest: '', kickIngest: '' }
};

function loadData() {
  try {
    if (fs.existsSync(JSON_PATH)) {
      data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
      console.log('JSON data loaded:', JSON_PATH);
    } else {
      saveData();
    }
  } catch (e) {
    console.log('Error loading:', e.message);
    saveData();
  }
}

function saveData() {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

loadData();

// =======================
// WebSocket Server
// =======================
const wss = new WebSocketServer({ port: 6970 });
let clients = [];
let ffmpegProc = null;
let streamConfig = null;

wss.on('connection', (ws) => {
  clients.push(ws);
  console.log('Client connected');
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      
      // Check if it's a stream config (not DB message)
      if (msg.twitchKey || msg.kickUrl) {
        startFFmpeg(ws, msg);
        return;
      }
      
      // DB messages
      handleDbMessage(ws, msg);
    } catch (e) {
      // Binary stream data - forward to FFmpeg
      if (ffmpegProc && ffmpegProc.stdin) {
        ffmpegProc.stdin.write(message);
      }
    }
  });
  
  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
    if (ffmpegProc) {
      ffmpegProc.kill();
      ffmpegProc = null;
    }
  });
});

function handleDbMessage(ws, msg) {
  const { type, data: msgData, id } = msg;
  
  switch (type) {
    case 'db_load_scenes':
      ws.send(JSON.stringify({ type: 'scenes_loaded', data: data.scenes }));
      break;
      
    case 'db_save_scene':
      const { id: sceneId, name, layers } = msgData;
      const idx = data.scenes.findIndex(s => s.id === sceneId);
      const sceneData = { id: sceneId, name, layers, updated_at: Date.now() };
      if (idx >= 0) data.scenes[idx] = sceneData;
      else data.scenes.push(sceneData);
      saveData();
      ws.send(JSON.stringify({ type: 'scene_saved', id: sceneId }));
      console.log('Scene saved:', name, layers?.length || 0, 'layers');
      break;
      
    case 'db_delete_scene':
      data.scenes = data.scenes.filter(s => s.id !== id);
      saveData();
      ws.send(JSON.stringify({ type: 'scene_deleted', id }));
      break;
      
    case 'db_load_settings':
      ws.send(JSON.stringify({ type: 'settings_loaded', data: data.settings }));
      break;
      
    case 'db_save_settings':
      data.settings = { ...data.settings, ...msgData };
      saveData();
      ws.send(JSON.stringify({ type: 'settings_saved' }));
      console.log('Settings saved');
      break;
      
    default:
      // Broadcast to other clients
      clients.forEach(c => {
        if (c !== ws && c.readyState === 1) {
          c.send(JSON.stringify(msg));
        }
      });
  }
}

function startFFmpeg(ws, config) {
  streamConfig = config;
  console.log('Starting FFmpeg with config:', config);
  
  const bitrate = config.bitrate || '4500k';
  const codec = config.codec || 'libx264';
  
  const args = [
    '-i', '-',
    '-c:v', codec,
    '-b:v', bitrate,
    '-g', '60',
    '-keyint_min', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv'
  ];
  
  if (config.twitchKey) {
    args.push('rtmp://live.twitch.tv/app/' + config.twitchKey);
  } else if (config.kickUrl) {
    args.push(config.kickUrl);
  }
  
  console.log('FFmpeg args:', args);
  
  ffmpegProc = spawn('ffmpeg', args);
  
  ffmpegProc.stderr.on('data', (d) => console.log('FFmpeg:', d.toString().substr(0, 100)));
  ffmpegProc.on('close', () => {
    console.log('FFmpeg ended');
    ffmpegProc = null;
  });
  
  ws.send(JSON.stringify({ type: 'streaming_started' }));
}

// =======================
// HTTP Server
// =======================
const HTTP_PORT = 6971;

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Proxy
  if (req.url.startsWith('/proxy?url=')) {
    const url = decodeURIComponent(req.url.split('url=')[1]);
    https.get(url, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }).on('error', () => {
      res.writeHead(500);
      res.end('Proxy error');
    });
    return;
  }
  
  // Local file serving
  let filePath = path.join(__dirname, 'web', req.url === '/' ? 'index.html' : req.url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(HTTP_PORT, () => {
  console.log('HTTP server on port', HTTP_PORT);
});

// =======================
// Events Server (for overlays)
// =======================
const EVENTS_PORT = 6972;
const eventsServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  if (req.url === '/events') {
    res.write('retry: 5000\n\n');
    
    const onEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    
    req.on('close', () => {
      console.log('Events client disconnected');
    });
    return;
  }
  
  res.writeHead(404);
  res.end();
});

eventsServer.listen(EVENTS_PORT, () => {
  console.log('Events server on port', EVENTS_PORT);
});

console.log('Server ready, JSON:', JSON_PATH);