const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const tls = require('tls');

const WS_PORT = 6970;
const HTTP_PORT = 6971;
const EVENTS_PORT = 6972;

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
  } catch (e) {}
}
loadEnv();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type');
   
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    
  if (req.url?.startsWith('/local?')) {
    const filePath = new URL(req.url, `http://localhost:${HTTP_PORT}`).searchParams.get('path');
    if (filePath) {
      const fs = require('fs');
      const path = require('path');
      const baseDir = path.join(__dirname, 'web');
      const fullPath = path.join(baseDir, filePath);
      if (!fullPath.startsWith(baseDir)) { res.writeHead(403); res.end('Forbidden'); return; }
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = {
          '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
          '.js': 'application/javascript', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
        }[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(200);
        res.write(content);
        res.end();
      } else { res.writeHead(404); res.end('Not found'); }
      return;
    }
  }
   
  if (req.url?.startsWith('/proxy?')) {
    const urlParam = new URL(req.url, `http://localhost:${HTTP_PORT}`).searchParams.get('url');
    if (urlParam) {
      let targetUrl = urlParam;
      if (!urlParam.startsWith('http://') && !urlParam.startsWith('https://')) {
        targetUrl = 'http://' + urlParam;
      }
      let parsedUrl;
      try { parsedUrl = new URL(targetUrl); }
      catch (e) { res.writeHead(400); res.end('Invalid URL'); return; }
      const proxyLib = parsedUrl.protocol === 'https:' ? https : http;
      const proxyReq = proxyLib.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
      }, (proxyRes) => {
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(proxyRes.statusCode || 200);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => { res.writeHead(502); res.end('Proxy error'); });
      proxyReq.end();
      return;
    }
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(HTTP_PORT, () => { console.log(`HTTP server on port ${HTTP_PORT}`); });

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`WebSocket server on port ${WS_PORT}`);

const { spawn } = require('child_process');

let ffmpegProcess = null;
let streamActive = false;

wss.on('connection', (ws) => {
  console.log('Client connected to stream');
  let binaryChunkCount = 0;
   
  ws.on('message', (message, isBinary) => {
    // If it's binary data, pipe it to FFmpeg
    if (isBinary) {
      binaryChunkCount++;
      if (binaryChunkCount % 30 === 0) {
        console.log(`Received ${binaryChunkCount} binary chunks from browser...`);
      }
      if (ffmpegProcess && ffmpegProcess.stdin.writable) {
        ffmpegProcess.stdin.write(message);
      }
      return;
    }
    
    // Otherwise it's config string
    if (!streamActive) {
      try {
        const config = JSON.parse(message.toString());
        console.log('Starting stream with config:', config);
        startRTMPStream(config);
        streamActive = true;
      } catch (e) {}
    }
  });
   
  ws.on('close', () => {
    console.log('Client disconnected');
    stopRTMPStream();
    streamActive = false;
  });
});

const eventServer = net.createServer((socket) => {
  console.log('Event client connected');
  socket.on('data', (data) => {
    const messages = data.toString().split('\n').filter(m => m.trim());
    messages.forEach(msg => {
      try {
        const event = JSON.parse(msg);
        console.log('Event received:', event.type, event.data);
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'event', data: event }));
          }
        });
      } catch (e) {}
    });
  });
  socket.on('close', () => { console.log('Event client disconnected'); });
});

eventServer.listen(EVENTS_PORT, () => { console.log(`Events server on port ${EVENTS_PORT}`); });

function startRTMPStream(config) {
  if (ffmpegProcess) {
    console.log('Stream already active');
    return;
  }

  const twitchKey = (config.twitchKey && config.twitchKey !== 'using_env') ? config.twitchKey : process.env.TWITCH_KEY;
  const kickStreamUrl = (config.kickUrl && config.kickUrl !== 'using_env') ? config.kickUrl : process.env.KICK_STREAM_URL;
  const kickKey = (config.kickUrl && config.kickUrl !== 'using_env') ? config.kickUrl : process.env.KICK_KEY;
  
  let outputs = [];
  if (twitchKey) {
    outputs.push(`[f=flv:onfail=ignore]rtmp://live.twitch.tv/app/${twitchKey}`);
  }
  
  if (kickStreamUrl && kickKey) {
    let kickUrl = kickStreamUrl.replace(/\/+$/, '');
    if (!kickUrl.endsWith('/app')) {
      kickUrl += '/app';
    }
    outputs.push(`[f=flv:onfail=ignore]${kickUrl}/${kickKey}`);
  }
  
  if (outputs.length === 0) {
    console.log('No outputs configured');
    return;
  }

  const teeOutputs = outputs.join('|');

  // We add anullsrc to generate a silent audio track, which Twitch requires to keep the connection open!
  const args = [
    '-y',
    '-f', 'webm',               // Receive WebM from frontend
    '-i', 'pipe:0',             // Read from stdin
    '-f', 'lavfi',              // Generate silent audio
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',          // Encode video to H.264
    '-preset', 'veryfast',
    '-b:v', config.bitrate || '4500k',
    '-maxrate', config.bitrate || '4500k',
    '-bufsize', '9000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',                 // Keyframe interval
    '-c:a', 'aac',              // Encode audio to AAC
    '-b:a', '128k',
    '-map', '0:v',              // Map video from pipe
    '-map', '1:a',              // Map audio from lavfi
    '-f', 'tee',                // Mux to multiple outputs
    teeOutputs
  ];

  console.log('Starting FFmpeg...');
  ffmpegProcess = spawn('ffmpeg', args);
  
  ffmpegProcess.stderr.on('data', (data) => {
    const str = data.toString().trim();
    // Ignore harmless warnings about pipe:0 to avoid spam, but print everything else
    if (str && !str.includes('frame=') && !str.includes('size=')) {
      console.log('FFmpeg:', str);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    ffmpegProcess = null;
  });
}

function stopRTMPStream() {
  if (ffmpegProcess) {
    console.log('Stopping FFmpeg stream...');
    ffmpegProcess.stdin.end();
    ffmpegProcess.kill('SIGINT');
    ffmpegProcess = null;
  }
}

console.log(`Server ready`);