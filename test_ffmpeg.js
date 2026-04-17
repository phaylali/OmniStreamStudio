const { spawn } = require('child_process');
const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '4500k',
    '-f', 'flv',
    'rtmp://live.twitch.tv/app/test'
]);
ffmpeg.stderr.on('data', d => console.log('FFmpeg:', d.toString().trim()));
setTimeout(() => ffmpeg.kill(), 2000);
