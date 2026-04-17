const { spawn } = require('child_process');
console.log("Checking ffmpeg presence...");
const ffmpeg = spawn('ffmpeg', ['-version']);
ffmpeg.stdout.on('data', d => console.log(d.toString().split('\n')[0]));
