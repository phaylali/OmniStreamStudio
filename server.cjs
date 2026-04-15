const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const WS_PORT = 6970;

// Just a simple placeholder - Vite serves everything on 6969
// This server only runs for WebSocket on 6970

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
        streamActive = true;
      } catch (e) {
        // Not JSON, might be video data
        console.log('Received video data chunk');
      }
    } else {
      // Video data chunk - send to FFmpeg stdin
      if (ffmpegProcess && ffmpegProcess.stdin.writable) {
        ffmpegProcess.stdin.write(message);
      }
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    stopFFmpeg();
    streamActive = false;
  });
});

function startFFmpeg(ws, config) {
  // Build FFmpeg command with tee for multiple outputs
  const outputs = [];
  
  // Twitch output
  if (config.twitchKey) {
    outputs.push(`[f=flv]rtmp://ingest.global-contribute.live-video.net/app/${config.twitchKey}`);
  }
  
  // Kick output  
  if (config.kickUrl) {
    outputs.push(`[f=flv]${config.kickUrl}`);
  }
  
  // If no outputs configured, just transcode for testing
  if (outputs.length === 0) {
    console.log('No streaming outputs configured, running test mode');
    return;
  }
  
  const args = [
    '-loglevel', 'info',
    '-threads', '4',
    '-f', 'webm',          // Input format from browser
    '-i', '-',             // Read from stdin
    
    // Video encoding
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', config.bitrate || '4500k',
    '-g', '60',
    
    // Audio encoding  
    '-c:a', 'aac',
    '-b:a', '192k',
    
    // Multi-output using tee
    '-f', 'tee',
    outputs.join('|')
  ];
  
  console.log('Starting FFmpeg with args:', args);
  
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