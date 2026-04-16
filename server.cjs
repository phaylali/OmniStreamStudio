const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');

const WS_PORT = 6970;
const HTTP_PORT = 6971;
const EVENTS_PORT = 6972;

// Load environment variables from .env
function loadEnv() {
  try {
    const envPath = __dirname + '/.env';
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    }
  } catch (e) {
    // Ignore
  }
}
loadEnv();

// HTTP server for proxy and WebSocket
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
}
   
  // Serve local files /local?path=...
  if (req.url?.startsWith('/local?')) {
    const filePath = new URL(req.url, `http://localhost:${HTTP_PORT}`).searchParams.get('path');
    if (filePath) {
      const fs = require('fs');
      const path = require('path');
      const baseDir = path.join(__dirname, 'web');
      const fullPath = path.join(baseDir, filePath);
      
      // Security: prevent directory traversal
      if (!fullPath.startsWith(baseDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = {
          '.html': 'text/html',
          '.htm': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
        }[ext] || 'application/octet-stream';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(200);
        res.write(content);
        res.end();
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }
  }
   
  // Proxy /proxy?url=...
  if (req.url?.startsWith('/proxy?')) {
    const urlParam = new URL(req.url, `http://localhost:${HTTP_PORT}`).searchParams.get('url');
    if (urlParam) {
      console.log('Proxying:', urlParam);
      
      // Handle relative URLs by making them absolute
      let targetUrl = urlParam;
      if (!urlParam.startsWith('http://') && !urlParam.startsWith('https://')) {
        targetUrl = 'http://' + urlParam;
      }
      
      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid URL: ' + urlParam);
        return;
      }
      
      const proxyLib = parsedUrl.protocol === 'https:' ? https : http;
      
      const proxyReq = proxyLib.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      }, (proxyRes) => {
        console.log('Proxy response status:', proxyRes.statusCode);
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(proxyRes.statusCode || 200);
        proxyRes.pipe(res);
      });
      
      proxyReq.on('error', (e) => {
        console.error('Proxy error:', e.message);
        res.writeHead(502);
        res.end('Proxy error');
      });
      
      proxyReq.end();
      return;
    }
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(HTTP_PORT, () => {
  console.log(`HTTP server running on port ${HTTP_PORT}`);
});

// WebSocket server for streaming
const wss = new WebSocketServer({ port: WS_PORT });

console.log(`WebSocket server running on port ${WS_PORT}`);

let ffmpegProcess = null;
let streamActive = false;

wss.on('connection', (ws) => {
  console.log('Client connected to stream');
  
  ws.on('message', (message) => {
    // First message: contains stream config
    if (!streamActive) {
      try {
        const config = JSON.parse(message.toString());
        console.log('Starting stream with config:', config);
        startFFmpeg(ws, config);
        // Wait for FFmpeg to be ready before marking active
        setTimeout(() => {
          streamActive = true;
        }, 500);
      } catch (e) {
        // Not JSON, might be video data from WebCodecs
        // Try to parse as JSON for video chunks
        try {
          const msg = JSON.parse(message.toString());
          if (msg.type === 'video_chunk') {
            // WebCodecs video chunk
            const data = new Uint8Array(msg.data);
            if (ffmpegProcess && ffmpegProcess.stdin.writable) {
              ffmpegProcess.stdin.write(data);
            }
          }
        } catch (e2) {
          // Plain binary - treat as MJPEG
          console.log('Received video data chunk, size:', message.length);
          if (ffmpegProcess && ffmpegProcess.stdin.writable) {
            ffmpegProcess.stdin.write(message);
          }
        }
      }
    } else {
      // Video data chunk - check if it's WebCodecs format
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'video_chunk') {
          // WebCodecs chunk - send binary directly
          const data = new Uint8Array(msg.data);
          if (ffmpegProcess && ffmpegProcess.stdin.writable) {
            ffmpegProcess.stdin.write(Buffer.from(data));
          }
        }
      } catch (e) {
        // Plain binary (MJPEG) - send as-is
        if (ffmpegProcess && ffmpegProcess.stdin.writable) {
          ffmpegProcess.stdin.write(message);
        }
      }
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    stopFFmpeg();
    streamActive = false;
  });
});

// --- Events TCP Server ---
// Listens for external events (follows, alerts, etc.) from scripts
// Format: JSON payload per line
const eventServer = net.createServer((socket) => {
  console.log('Event client connected');
  
  socket.on('data', (data) => {
    const messages = data.toString().split('\n').filter(m => m.trim());
    
    messages.forEach(msg => {
      try {
        const event = JSON.parse(msg);
        console.log('Event received:', event.type, event.data);
        
        // Broadcast to all connected clients
        wss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(JSON.stringify({ type: 'event', data: event }));
          }
        });
      } catch (e) {
        // Ignore invalid JSON
      }
    });
  });
  
  socket.on('close', () => {
    console.log('Event client disconnected');
  });
});

eventServer.listen(EVENTS_PORT, () => {
  console.log(`Events server running on port ${EVENTS_PORT}`);
});

// Helper function for scripts to send events
function sendEvent(type, data) {
  return JSON.stringify({ type, data });
}

function startFFmpeg(ws, config) {
  // Build FFmpeg command with tee for multiple outputs
  const outputs = [];
  
  // Get stream keys - use .env when config is 'using_env' or null
  const twitchKey = (config.twitchKey && config.twitchKey !== 'using_env') 
    ? config.twitchKey 
    : process.env.TWITCH_KEY;
  const kickUrl = (config.kickUrl && config.kickUrl !== 'using_env')
    ? config.kickUrl 
    : (process.env.KICK_STREAM_URL + '/' + process.env.KICK_KEY).replace(/([^:]\/)\/+/g, '$1');
  
  // Twitch output
  if (twitchKey) {
    const twitchUrl = `rtmp://ingest.global-contribute.live-video.net/app/${twitchKey}`;
    console.log('Twitch stream URL:', twitchUrl);
    outputs.push(twitchUrl);
  }
  
  // Kick output  
  if (kickUrl && process.env.KICK_STREAM_URL) {
    console.log('Kick stream URL:', kickUrl);
    outputs.push(kickUrl);
  }
  
  // If no outputs configured
  if (outputs.length === 0) {
    console.log('No streaming outputs configured');
    console.log('Available env keys:', Object.keys(process.env).filter(k => k.includes('TWITCH') || k.includes('KICK')));
    return;
  }
  
  const isH264 = config.codec && config.codec.startsWith('avc1');
  const isVP9 = config.codec && config.codec.startsWith('vp09');
  
  let inputFormat = 'mjpeg';
  let framerate = '15';
  
  if (isH264 || isVP9) {
    inputFormat = isH264 ? 'h264' : 'hevc';
    framerate = '30';
  }
  
  const args = [
    '-loglevel', 'info',
    '-threads', '4',
    '-re',
    '-f', inputFormat,
    '-framerate', framerate,
    '-i', '-',
    
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', config.bitrate || '4500k',
    '-g', '30',
  ];
  
  // Add output based on number of streams
  if (outputs.length === 1) {
    // Single output - simple format
    args.push('-f', 'flv', outputs[0]);
  } else {
    // Multiple outputs - use tee with proper syntax
    const teeOutputs = outputs.map(o => `[f=flv]${o}`).join('|');
    args.push('-f', 'tee', teeOutputs);
  }
  
  console.log('Starting FFmpeg with output(s):', outputs.length);
  
  ffmpegProcess = spawn('ffmpeg', args);
  
  ffmpegProcess.stderr.on('data', (data) => {
    console.log('FFmpeg:', data.toString());
  });
  
  ffmpegProcess.on('close', (code) => {
    console.log('FFmpeg exited with code:', code);
    ffmpegProcess = null;
  });
  
  ffmpegProcess.stdin.on('error', (err) => {
    console.log('FFmpeg stdin error:', err.message);
  });
}

function stopFFmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
  }
}

console.log(`WebSocket server running on port ${WS_PORT}`);