use log::info;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tauri::{State, Emitter};
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader, AsyncReadExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Twitch,
    Kick,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    pub platform: Platform,
    pub url: String,
}

pub struct StreamState {
    pub is_live: bool,
    pub child: Option<tokio::process::Child>,
    pub preview_child: Option<tokio::process::Child>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self { is_live: false, child: None, preview_child: None }
    }
}

pub struct AppState {
    pub stream: tokio::sync::Mutex<StreamState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { 
            stream: tokio::sync::Mutex::new(StreamState::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderInfo {
    pub id: String,
    pub name: String,
    pub type_: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Layer {
    Monitor { id: String, source_id: String, x: i32, y: i32, w: u32, h: u32, active: bool, volume: f32, audio_input: String },
    Camera { id: String, source_id: String, x: i32, y: i32, w: u32, h: u32, active: bool, volume: f32 },
    Image { id: String, path: String, x: i32, y: i32, w: u32, h: u32, active: bool },
    Video { id: String, path: String, x: i32, y: i32, w: u32, h: u32, active: bool, loop_: bool, volume: f32, playing: bool },
    Mic { id: String, source_id: String, volume: f32, active: bool },
    Music { id: String, path: String, volume: f32, active: bool, playing: bool },
    Placeholder { id: String, color: String, x: i32, y: i32, w: u32, h: u32, active: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_app: f32,
    pub cpu_ffmpeg: f32,
    pub gpu_load: u32,
    pub vram_used: u64,
}

#[tauri::command]
fn get_audio_devices() -> Result<Vec<DeviceInfo>, String> {
    let mut devices = Vec::new();
    if let Ok(output) = std::process::Command::new("pactl").args(["list", "short", "sources"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                devices.push(DeviceInfo { id: parts[1].to_string(), name: format!("(Mic) {}", parts[1].replace("alsa_input.", "")) });
            }
        }
    }
    if let Ok(output) = std::process::Command::new("pactl").args(["list", "short", "sinks"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                devices.push(DeviceInfo { id: format!("{}.monitor", parts[1]), name: format!("(System) {}", parts[1].replace("alsa_output.", "")) });
            }
        }
    }
    Ok(devices)
}

#[tauri::command]
fn get_audio_sinks() -> Result<Vec<DeviceInfo>, String> {
    let mut sinks = Vec::new();
    if let Ok(output) = std::process::Command::new("pactl").args(["list", "short", "sinks"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                sinks.push(DeviceInfo { id: parts[1].to_string(), name: parts[1].replace("alsa_output.", "") });
            }
        }
    }
    Ok(sinks)
}

#[tauri::command]
fn get_video_devices() -> Result<Vec<DeviceInfo>, String> {
    let mut devices = Vec::new();
    
    // Try /dev/video0-31
    for i in 0..32 {
        let path = format!("/dev/video{}", i);
        if std::path::Path::new(&path).exists() {
            // Try to get device name using v4l2-ctl
            let name = if let Ok(output) = std::process::Command::new("v4l2-ctl")
                .arg("-d")
                .arg(&path)
                .arg("--device-info")
                .output()
            {
                let out = String::from_utf8_lossy(&output.stdout);
                out.lines()
                    .find(|l| l.starts_with("Device"))
                    .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
                    .unwrap_or_else(|| format!("Camera {}", i))
            } else {
                format!("Camera {}", i)
            };
            devices.push(DeviceInfo { id: path.clone(), name });
        }
    }
    
    // Also check /dev/v4l/by-id and /dev/v4l/by-path for additional devices
    let by_id_path = std::path::Path::new("/dev/v4l/by-id");
    let _by_path_path = std::path::Path::new("/dev/v4l/by-path");
    
    if let Ok(entries) = std::fs::read_dir(by_id_path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.contains("video") {
                    if let Ok(link) = std::fs::read_link(entry.path()) {
                        if let Some(dev_name) = link.file_name() {
                            let dev_str = dev_name.to_string_lossy().to_string();
                            if !devices.iter().any(|d: &DeviceInfo| d.id.ends_with(&dev_str)) {
                                devices.push(DeviceInfo { 
                                    id: format!("/dev/{}", dev_str), 
                                    name: name.replace("-video", "").replace("_", " ") 
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(devices)
}

#[tauri::command]
fn get_available_encoders() -> Vec<EncoderInfo> {
    let mut encoders = Vec::new();
    #[cfg(target_os = "linux")]
    {
        for i in 128..135 {
            let path = format!("/dev/dri/renderD{}", i);
            if std::path::Path::new(&path).exists() {
                let gpu_name = if let Ok(output) = std::process::Command::new("sh")
                    .arg("-c").arg("lspci | grep -iE 'vga|display'").output() {
                    let out = String::from_utf8_lossy(&output.stdout);
                    let lines: Vec<&str> = out.lines().collect();
                    let target_line = lines.iter().find(|l| !l.to_lowercase().contains("intel"))
                        .unwrap_or(lines.first().unwrap_or(&"Discrete GPU"));
                    target_line.split(": ").last().unwrap_or("Discrete GPU").trim().to_string()
                } else { format!("GPU (renderD{})", i) };
                encoders.push(EncoderInfo { id: format!("vaapi:{}", path), name: format!("VAAPI - {}", gpu_name), type_: "gpu".to_string() });
            }
        }
    }
    encoders.push(EncoderInfo { id: "cpu".to_string(), name: "Software (x264)".to_string(), type_: "cpu".to_string() });
    encoders
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub resolution: String,
    pub is_default: bool,
}

#[tauri::command]
fn get_monitors() -> Vec<MonitorInfo> {
    let mut monitors = Vec::new();
    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
    let base_display = if display.contains('.') { display } else { format!("{}.0", display) };

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("xrandr").arg("--listmonitors").output() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            for line in out_str.lines() {
                if line.contains(':') && !line.contains("Monitors:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let is_primary = line.contains('*');
                        let monitor_name = parts.last().unwrap_or(&"Unknown").to_string();
                        if let Some(geom) = parts.iter().find(|p| p.contains('x') && p.contains('+')) {
                             let offsets: Vec<&str> = geom.split('+').collect();
                             let x_off = offsets.get(1).unwrap_or(&"0");
                             let y_off = offsets.get(2).unwrap_or(&"0");
                             
                             let res_part = offsets.get(0).unwrap_or(&"1920x1080");
                             let dim_parts: Vec<&str> = res_part.split('x').collect();
                             let native_w = dim_parts.get(0).unwrap_or(&"1920").split('/').next().unwrap_or("1920");
                             let native_h = dim_parts.get(1).unwrap_or(&"1080").split('/').next().unwrap_or("1080");
                             let valid_res = format!("{}x{}", native_w, native_h);

                             monitors.push(MonitorInfo {
                                 id: format!("{}+{},{}", base_display, x_off, y_off),
                                 name: format!("Monitor {} ({})", monitor_name, valid_res),
                                 resolution: valid_res,
                                 is_default: is_primary,
                             });
                        }
                    }
                }
            }
        }
    }
    monitors
}

#[tauri::command]
async fn get_system_usage(state: State<'_, AppState>) -> Result<SystemStats, String> {
    let mut stats = SystemStats { cpu_app: 0.0, cpu_ffmpeg: 0.0, gpu_load: 0, vram_used: 0 };
    if let Ok(content) = std::fs::read_to_string("/sys/class/drm/card1/device/hwmon/hwmon1/device/gpu_busy_percent") {
        stats.gpu_load = content.trim().parse().unwrap_or(0);
    } else if let Ok(content) = std::fs::read_to_string("/sys/class/drm/card0/device/hwmon/hwmon0/device/gpu_busy_percent") {
        stats.gpu_load = content.trim().parse().unwrap_or(0);
    }
    if let Ok(content) = std::fs::read_to_string("/sys/class/drm/card1/device/mem_info_vram_used") {
        stats.vram_used = content.trim().parse::<u64>().unwrap_or(0) / 1024 / 1024;
    }
    if let Ok(output) = std::process::Command::new("ps").args(["-p", &std::process::id().to_string(), "-o", "%cpu"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = out.lines().nth(1) { stats.cpu_app = line.trim().parse().unwrap_or(0.0); }
    }
    let ffmpeg_pid = {
        let stream_state = state.stream.lock().await;
        stream_state.child.as_ref().and_then(|c| c.id())
    };
    if let Some(pid) = ffmpeg_pid {
        if let Ok(output) = std::process::Command::new("ps").args(["-p", &pid.to_string(), "-o", "%cpu"]).output() {
            let out = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = out.lines().nth(1) { stats.cpu_ffmpeg = line.trim().parse().unwrap_or(0.0); }
        }
    }
    Ok(stats)
}

fn apply_layers_to_ffmpeg(cmd: &mut Command, layers: &Vec<Layer>, framerate: u32, is_vaapi: bool, include_audio: bool) -> Result<String, String> {
    // For preview mode, don't capture audio sources - just video
    let do_audio = include_audio;
    
    // Bulletproof solid black background, avoids "No such file" errors
    cmd.arg("-f").arg("lavfi").arg("-i").arg(format!("color=c=black:s=1920x1080:r={}", framerate));

    let mut input_counter = 1;
    let mut filter_parts = Vec::new();
    let mut current_video_link = "[0:v]".to_string();
    let mut audio_inputs = Vec::new();

    for (idx, layer) in layers.iter().enumerate() {
        let active = match layer {
            Layer::Monitor { active, .. } => *active,
            Layer::Camera { active, .. } => *active,
            Layer::Image { active, .. } => *active,
            Layer::Video { active, .. } => *active,
            Layer::Mic { active, .. } => *active,
            Layer::Music { active, .. } => *active,
            Layer::Placeholder { active, .. } => *active,
        };
        if !active { continue; }

        match layer {
            Layer::Monitor { source_id, x, y, w, h, volume, audio_input, .. } => {
                // FIX: Look up native monitor resolution to avoid cropping
                let mut native_res = "1920x1080".to_string();
                if let Ok(output) = std::process::Command::new("xrandr").arg("--listmonitors").output() {
                    let out_str = String::from_utf8_lossy(&output.stdout);
                    let display_port = source_id.split('+').nth(1).unwrap_or("");
                    let match_str = format!("+{}", display_port.replace(',', "+"));
                    for line in out_str.lines() {
                        if line.contains(&match_str) {
                             if let Some(geom) = line.split_whitespace().find(|p| p.contains('x') && p.contains('+')) {
                                 let offsets: Vec<&str> = geom.split('+').collect();
                                 let res_part = offsets.get(0).unwrap_or(&"1920x1080");
                                 let dim_parts: Vec<&str> = res_part.split('x').collect();
                                 let native_w = dim_parts.get(0).unwrap_or(&"1920").split('/').next().unwrap_or("1920");
                                 let native_h = dim_parts.get(1).unwrap_or(&"1080").split('/').next().unwrap_or("1080");
                                 native_res = format!("{}x{}", native_w, native_h);
                             }
                        }
                    }
                }

                cmd.arg("-f").arg("x11grab")
                   .arg("-framerate").arg(framerate.to_string())
                   .arg("-video_size").arg(&native_res)
                   .arg("-i").arg(source_id);

                // Capture audio only if user selected an audio source for this monitor
                if do_audio && !audio_input.is_empty() && audio_input != "none" {
                    cmd.arg("-f").arg("pulse").arg("-i").arg(&audio_input);
                    let a_link = format!("[{}:a]volume={}[a{}]", input_counter + 1, volume, idx);
                    filter_parts.push(a_link);
                    audio_inputs.push(format!("[a{}]", idx));
                }

                let in_link = format!("[{}:v]", input_counter);
                filter_parts.push(format!("{}scale={}x{}:flags=fast_bilinear[mon{}]; {}[mon{}]overlay={}:{}[v_next{}]", 
                    in_link, w, h, idx, current_video_link, idx, x, y, idx));
                current_video_link = format!("[v_next{}]", idx);
                input_counter += if do_audio && !audio_input.is_empty() && audio_input != "none" { 2 } else { 1 };
            }
            Layer::Camera { source_id, x, y, w, h, volume, .. } => {
                cmd.arg("-f").arg("video4linux2")
                   .arg("-input_format")
                   .arg("mjpeg")
                   .arg("-i")
                   .arg(source_id);
                // Only add audio input if we're including audio
                if do_audio {
                    cmd.arg("-f").arg("lavfi").arg("-i").arg("anullsrc=r=44100:cl=stereo");
                    let a_link = format!("[{}:a]volume={}[a{}]", input_counter + 1, volume, idx);
                    filter_parts.push(a_link);
                    audio_inputs.push(format!("[a{}]", idx));
                }
                filter_parts.push(format!("{}[{}:v]scale={}x{}:flags=fast_bilinear[cam{}]; {}[cam{}]overlay={}:{}[v_next{}]", 
                    "", input_counter, w, h, idx, current_video_link, idx, x, y, idx));
                current_video_link = format!("[v_next{}]", idx);
                input_counter += if do_audio { 2 } else { 1 };
            }
            Layer::Image { path, x, y, w, h, .. } => {
                if !std::path::Path::new(path).exists() { eprintln!("Skipping missing image: {}", path); continue; }
                cmd.arg("-loop").arg("1").arg("-i").arg(path);
                filter_parts.push(format!("{}[{}:v]scale={}x{}:flags=fast_bilinear[img{}]; {}[img{}]overlay={}:{}[v_next{}]", 
                    "", input_counter, w, h, idx, current_video_link, idx, x, y, idx));
                current_video_link = format!("[v_next{}]", idx);
                input_counter += 1;
            }
            Layer::Video { path, x, y, w, h, loop_, volume, playing, .. } => {
                // Skip video if paused
                if !playing { continue; }
                
                if !std::path::Path::new(path).exists() { eprintln!("Skipping missing video: {}", path); continue; }
                if *loop_ { cmd.arg("-stream_loop").arg("-1"); }
                cmd.arg("-i").arg(path);
                filter_parts.push(format!("{}[{}:v]scale={}x{}:flags=fast_bilinear[vid{}]; {}[vid{}]overlay={}:{}[v_next{}]", 
                    "", input_counter, w, h, idx, current_video_link, idx, x, y, idx));
                current_video_link = format!("[v_next{}]", idx);
                // Extract video audio and apply volume (only if audio is needed)
                if do_audio {
                    let a_link = format!("[{}:a]volume={}[a{}]", input_counter, volume, idx);
                    filter_parts.push(a_link);
                    audio_inputs.push(format!("[a{}]", idx));
                }
                input_counter += 1;
            }
            Layer::Mic { source_id, volume, .. } => {
                if !do_audio { continue; }
                cmd.arg("-f").arg("pulse").arg("-i").arg(source_id);
                let a_link = format!("[{}:a]volume={}[a{}]", input_counter, volume, idx);
                filter_parts.push(a_link);
                audio_inputs.push(format!("[a{}]", idx));
                input_counter += 1;
            }
            Layer::Music { path, volume, playing, .. } => {
                // Skip music if paused
                if !playing { continue; }
                
                if !std::path::Path::new(path).exists() { eprintln!("Skipping missing music: {}", path); continue; }
                if !do_audio { continue; }
                cmd.arg("-stream_loop").arg("-1").arg("-i").arg(path);
                let a_link = format!("[{}:a]volume={}[a{}]", input_counter, volume, idx);
                filter_parts.push(a_link);
                audio_inputs.push(format!("[a{}]", idx));
                input_counter += 1;
            }
            _ => {}
        }
    }

    let mut filter_complex = filter_parts.join("; ");
    if current_video_link == "[0:v]" {
        if !filter_complex.is_empty() { filter_complex.push_str("; "); }
        filter_complex.push_str("[0:v]copy[v_end]");
        current_video_link = "[v_end]".to_string();
    }

    if is_vaapi {
        if !filter_complex.is_empty() { filter_complex.push_str("; "); }
        filter_complex.push_str(&format!("{}format=nv12,hwupload[outv_hw]", current_video_link));
        current_video_link = "[outv_hw]".to_string();
    }

    if include_audio {
        if !audio_inputs.is_empty() {
            filter_complex.push_str(&format!("; {}amix=inputs={}[outa]", audio_inputs.join(""), audio_inputs.len()));
        } else {
            cmd.arg("-f").arg("lavfi").arg("-i").arg("anullsrc=r=44100:cl=stereo");
            filter_complex.push_str(&format!("; [{}:a]anull[outa]", input_counter));
        }
    }

    cmd.arg("-filter_complex").arg(filter_complex);

    Ok(current_video_link)
}

#[tauri::command]
async fn start_stream(
    configs: Vec<StreamConfig>,
    layers: Vec<Layer>,
    keyint: u32,
    encoder_type: String,
    quality: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting pristine backend-compositor stream with encoder: {}", encoder_type);

    // Stop existing stream if running to apply new settings
    {
        let mut stream_state = state.stream.lock().await;
        if stream_state.is_live { 
            if let Some(mut c) = stream_state.child.take() {
                let _ = c.kill().await;
            }
            stream_state.is_live = false;
        }
    }

    let (_, framerate, bitrate) = match quality.as_str() {
        "720p30" => ("1280x720", 30, "3000k"),
        "1080p60" => ("1920x1080", 60, "6000k"),
        _ => ("1920x1080", 30, "4500k"),
    };

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel").arg("info");

    let is_vaapi = encoder_type.starts_with("vaapi:");
    if is_vaapi {
        let device_path = encoder_type.split(':').nth(1).unwrap_or("/dev/dri/renderD128");
        cmd.arg("-init_hw_device").arg(format!("vaapi=gpu:{}", device_path));
    }

    let video_out_link = apply_layers_to_ffmpeg(&mut cmd, &layers, framerate, is_vaapi, true)?;

    let encoder_v = if is_vaapi { "h264_vaapi".to_string() }
    else if encoder_type == "nvenc" { "h264_nvenc".to_string() }
    else { "libx264".to_string() };

    cmd.arg("-map").arg(&video_out_link).arg("-map").arg("[outa]")
       .arg("-c:v").arg(encoder_v)
       .arg("-b:v").arg(bitrate)
       .arg("-g").arg(keyint.to_string())
       .arg("-c:a").arg("aac")
       .arg("-b:a").arg("192k")
       .arg("-flags").arg("+global_header");

    if configs.len() > 1 {
        let tee_outputs: Vec<String> = configs.iter().map(|c| format!("[f=flv]{}", c.url.replace("|", "\\|"))).collect();
        cmd.arg("-f").arg("tee").arg(tee_outputs.join("|"));
    } else if let Some(config) = configs.first() {
        cmd.arg("-f").arg("flv").arg(&config.url);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            let mut stream_state = state.stream.lock().await;
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await { eprintln!("FFmpeg Stream: {}", line); }
                });
            }
            stream_state.child = Some(child);
            stream_state.is_live = true;
            Ok("Stream started".to_string())
        }
        Err(e) => Err(format!("Failed to spawn FFmpeg: {}", e)),
    }
}

#[tauri::command]
async fn stop_stream(state: State<'_, AppState>) -> Result<(), String> {
    let mut stream_state = state.stream.lock().await;
    stream_state.is_live = false;
    if let Some(mut c) = stream_state.child.take() {
        let _ = c.kill().await;
    }
    Ok(())
}

#[tauri::command]
async fn force_stop_stream() -> Result<(), String> {
    // Kill all FFmpeg processes
    std::process::Command::new("pkill")
        .arg("-9")
        .arg("ffmpeg")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_preview(
    layers: Vec<Layer>,
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut stream_state = state.stream.lock().await;
    if stream_state.preview_child.is_some() { return Ok(()); }
    
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel").arg("error"); 

    // Re-use layer pipeline minus actual hardware encoding
    let video_out_link = apply_layers_to_ffmpeg(&mut cmd, &layers, 15, false, false)?;

    // Output only MJPEG video - image2pipe doesn't support audio muxing
    cmd.arg("-map").arg(&video_out_link);
    cmd.arg("-c:v").arg("mjpeg").arg("-qscale").arg("2").arg("-f").arg("image2pipe").arg("-");
    
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await { eprintln!("FFmpeg Preview: {}", line); }
        });
    }

    let stdout = child.stdout.take().ok_or("Failed to open preview pipe")?;
    
    tokio::spawn(async move {
        let mut reader = BufReader::with_capacity(262144, stdout);
        let mut buffer = Vec::new();
        let mut in_frame = false;
        let mut chunk = [0u8; 16384];
        while let Ok(n) = reader.read(&mut chunk).await {
            if n == 0 { break; }
            for i in 0..n {
                let b = chunk[i];
                if !in_frame {
                    if b == 0xFF { buffer.push(b); }
                    else if !buffer.is_empty() && buffer[buffer.len()-1] == 0xFF && b == 0xD8 {
                        buffer.push(b); in_frame = true;
                    } else { buffer.clear(); }
                    continue;
                }
                buffer.push(b);
                if buffer.len() > 2 && buffer[buffer.len()-2] == 0xFF && b == 0xD9 {
                    let base64 = data_encoding::BASE64.encode(&buffer);
                    let _ = window.emit("preview-frame", base64);
                    buffer.clear();
                    in_frame = false;
                }
                if buffer.len() > 5000000 { buffer.clear(); in_frame = false; }
            }
        }
    });
    stream_state.preview_child = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_preview(state: State<'_, AppState>) -> Result<(), String> {
    let child = {
        let mut stream_state = state.stream.lock().await;
        stream_state.preview_child.take()
    };
    if let Some(mut c) = child { let _ = c.kill().await; }
    Ok(())
}

#[tauri::command]
async fn check_twitch_channel(username: String) -> Result<bool, String> {
    let mut root_path = std::env::current_dir().unwrap_or_default();
    if root_path.ends_with("src-tauri") { root_path.pop(); }
    let mut script_path = root_path.clone();
    script_path.push("scripts");
    script_path.push("status.ts");
    match std::process::Command::new("bun").current_dir(&root_path).arg(&script_path).arg(&username).output() {
        Ok(output) => Ok(String::from_utf8_lossy(&output.stdout).contains("true")),
        Err(_) => Ok(false)
    }
}

// ============================================================================
// CANVAS-BASED RENDERING MODULE (Alternative to FFmpeg filter graphs)
// ============================================================================
// To enable canvas mode, use the start_canvas_stream command instead of start_stream
#[tauri::command]
async fn start_canvas_stream(
    configs: Vec<StreamConfig>,
    width: u32,
    height: u32,
    framerate: u32,
    bitrate: String,
    encoder_type: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting canvas-based stream");
    
    {
        let mut stream_state = state.stream.lock().await;
        if stream_state.is_live {
            if let Some(mut c) = stream_state.child.take() {
                let _ = c.kill().await;
            }
        }
    }
    
    let is_vaapi = encoder_type.starts_with("vaapi:");
    let encoder = if is_vaapi { "h264_vaapi" } 
                  else if encoder_type == "nvenc" { "h264_nvenc" }
                  else { "libx264" };
    
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel").arg("info");
    
    if is_vaapi {
        let device_path = encoder_type.split(':').nth(1).unwrap_or("/dev/dri/renderD128");
        cmd.arg("-init_hw_device").arg(format!("vaapi=gpu:{}", device_path));
    }
    
    // Canvas sends raw YUV420P frames via stdin
    cmd.arg("-f").arg("rawvideo")
       .arg("-pix_fmt").arg("yuv420p")
       .arg("-s").arg(format!("{}x{}", width, height))
       .arg("-r").arg(framerate.to_string())
       .arg("-i").arg("pipe:0");
    
    // Audio via lavfi silence (placeholder - can be replaced with actual audio)
    cmd.arg("-f").arg("lavfi").arg("-i").arg("anullsrc=r=44100:cl=stereo");
    
    if is_vaapi {
        cmd.arg("-vf").arg("format=nv12,hwupload");
    }
    
    cmd.arg("-c:v").arg(encoder)
       .arg("-b:v").arg(&bitrate)
       .arg("-g").arg("60")
       .arg("-c:a").arg("aac")
       .arg("-b:a").arg("192k")
       .arg("-flags").arg("+global_header");
    
    // Output
    if configs.len() > 1 {
        let tee_outputs: Vec<String> = configs.iter().map(|c| {
            format!("[f=flv]{}", c.url.replace("|", "\\|"))
        }).collect();
        cmd.arg("-f").arg("tee").arg(tee_outputs.join("|"));
    } else if let Some(config) = configs.first() {
        cmd.arg("-f").arg("flv").arg(&config.url);
    }
    
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    
    match cmd.spawn() {
        Ok(mut child) => {
            let mut stream_state = state.stream.lock().await;
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await { 
                        eprintln!("FFmpeg Canvas: {}", line); 
                    }
                });
            }
            stream_state.child = Some(child);
            stream_state.is_live = true;
            Ok("Canvas stream started".to_string())
        }
        Err(e) => Err(format!("Failed to spawn FFmpeg: {}", e)),
    }
}

// Push frame data from canvas to FFmpeg stdin
#[tauri::command]
async fn push_canvas_frame(data: Vec<u8>, state: State<'_, AppState>) -> Result<(), String> {
    let mut stream_state = state.stream.lock().await;
    if let Some(stdin) = stream_state.child.as_mut().and_then(|c| c.stdin.as_mut()) {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(&data).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_audio_devices,
            get_audio_sinks,
            get_video_devices,
            get_monitors,
            get_available_encoders,
            get_system_usage,
            start_stream,
            stop_stream,
            force_stop_stream,
            start_preview,
            stop_preview,
            check_twitch_channel,
            start_canvas_stream,
            push_canvas_frame
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}