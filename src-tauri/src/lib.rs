use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Mutex;
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
        Self {
            is_live: false,
            child: None,
            preview_child: None,
        }
    }
}

pub struct AppState {
    pub stream: Mutex<StreamState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            stream: Mutex::new(StreamState::default()),
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

#[tauri::command]
fn get_audio_devices() -> Result<Vec<DeviceInfo>, String> {
    let mut devices = Vec::new();

    // Fetch Sources (Inputs/Mics)
    if let Ok(output) = std::process::Command::new("pactl").args(["list", "short", "sources"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                devices.push(DeviceInfo {
                    id: parts[1].to_string(),
                    name: format!("(Mic) {}", parts[1].replace("alsa_input.", "")),
                });
            }
        }
    }

    // Fetch Sinks (Outputs/System Audio)
    if let Ok(output) = std::process::Command::new("pactl").args(["list", "short", "sinks"]).output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                // To capture a sink, we actually need its .monitor source
                devices.push(DeviceInfo {
                    id: format!("{}.monitor", parts[1]),
                    name: format!("(System) {}", parts[1].replace("alsa_output.", "")),
                });
            }
        }
    }

    Ok(devices)
}

#[tauri::command]
fn get_video_devices() -> Result<Vec<DeviceInfo>, String> {
    let mut devices = Vec::new();
    
    // Simple dev scan
    for i in 0..10 {
        let path = format!("/dev/video{}", i);
        if std::path::Path::new(&path).exists() {
            devices.push(DeviceInfo {
                id: path.clone(),
                name: format!("Webcam {}", i),
            });
        }
    }

    Ok(devices)
}

#[tauri::command]
async fn start_stream(
    configs: Vec<StreamConfig>,
    keyint: u32,
    encoder_type: String,
    monitor_id: String,
    resolution: String,
    quality: String,
    audio_input: String,
    audio_output: String,
    camera_device: String,
    camera_pos: String,
    camera_size: f32,
    volume_input: f32,
    volume_output: f32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting multi-stream V2 with {} platforms", configs.len());

    {
        let stream_state = state.stream.lock().map_err(|e| e.to_string())?;
        if stream_state.is_live {
            return Err("Stream already running".to_string());
        }
    }

    let (target_res, framerate, bitrate) = match quality.as_str() {
        "720p30" => ("1280x720", 30, "3000k"),
        "1080p60" => ("1920x1080", 60, "6000k"),
        _ => ("1920x1080", 30, "4500k"),
    };

    let placeholder = if target_res == "1280x720" { "placeholder_720p.jpg" } else { "placeholder_1080p.jpg" };

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel").arg("info");

    // Inputs
    // 0: Placeholder background
    cmd.arg("-loop").arg("1").arg("-i").arg(placeholder);

    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
    let base_display = if display.contains('.') { display } else { format!("{}.0", display) };
    let input_id = if monitor_id == "none" { 
        "none".to_string() 
    } else {
        format!("{}{}", base_display, monitor_id.replace(":0.0", ""))
    };

    // 1: Monitor Capture or Test Pattern
    if input_id == "none" {
        cmd.arg("-f").arg("lavfi")
           .arg("-i").arg(format!("testsrc=size={}:rate={}", resolution, framerate));
    } else {
        cmd.arg("-f").arg("x11grab")
           .arg("-framerate").arg(framerate.to_string())
           .arg("-video_size").arg(resolution)
           .arg("-i").arg(input_id);
    }

    // 2: Camera (if enabled)
    let has_camera = camera_device != "none";
    if has_camera {
        cmd.arg("-f").arg("video4linux2")
           .arg("-video_size").arg("640x480") // Default cam fetch
           .arg("-i").arg(camera_device);
    }

    // 3: Audio Input (Mic)
    cmd.arg("-f").arg("pulse").arg("-i").arg(audio_input);

    // 4: Audio Output (System)
    cmd.arg("-f").arg("pulse").arg("-i").arg(audio_output);

    // Filter Complex
    let mut filter = format!(
        "[1:v]scale={}:flags=fast_bilinear[scaled_mon]; [0:v][scaled_mon]overlay[bg]", 
        target_res.replace("x", ":")
    );

    if has_camera {
        let cam_w = (target_res.split('x').next().unwrap().parse::<f32>().unwrap() * camera_size) as u32;
        let pos = match camera_pos.as_str() {
            "top-left" => "x=10:y=10",
            "top-right" => "x=main_w-overlay_w-10:y=10",
            "bottom-left" => "x=10:y=main_h-overlay_h-10",
            _ => "x=main_w-overlay_w-10:y=main_h-overlay_h-10",
        };
        filter.push_str(&format!("; [2:v]scale={}:-1[scaled_cam]; [bg][scaled_cam]overlay={}[outv]", cam_w, pos));
    } else {
        filter.push_str("; [bg]copy[outv]");
    }

    // Audio Mixing
    filter.push_str(&format!(
        "; [3:a]volume={}[a1]; [4:a]volume={}[a2]; [a1][a2]amix=inputs=2[outa]",
        volume_input / 100.0, volume_output / 100.0
    ));

    cmd.arg("-filter_complex").arg(filter);

    // Encoder Selection
    let (encoder, encoder_args, _) = get_encoder_config(&encoder_type);
    
    cmd.arg("-map").arg("[outv]")
       .arg("-map").arg("[outa]")
       .arg("-c:v").arg(encoder)
       .args(encoder_args)
       .arg("-b:v").arg(bitrate)
       .arg("-g").arg(keyint.to_string())
       .arg("-c:a").arg("aac")
       .arg("-b:a").arg("192k");

    // Outputs
    for config in configs {
        cmd.args(["-f", "flv", &config.url]);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
            
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        info!("FFmpeg: {}", line);
                    }
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
    let child = {
        let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
        stream_state.is_live = false;
        stream_state.child.take()
    };

    if let Some(mut c) = child {
        let _ = c.kill().await;
    }
    Ok(())
}

#[tauri::command]
async fn start_preview(
    monitor_id: String,
    resolution: String,
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
    if stream_state.preview_child.is_some() {
        return Ok(());
    }

    info!("Starting preview for {}", monitor_id);

    let input_id = monitor_id;
    info!("Starting preview for Input: {}", input_id);

    let mut cmd = Command::new("ffmpeg");
    if input_id == "none" {
        cmd.args([
            "-f", "lavfi",
            "-i", &format!("testsrc=size={}:rate=15", resolution),
            "-c:v", "mjpeg",
            "-f", "image2pipe",
            "pipe:1"
        ]);
    } else {
        cmd.args([
            "-f", "x11grab",
            "-framerate", "15",
            "-video_size", &resolution,
            "-i", &input_id,
            "-vf", "scale=640:-1",
            "-c:v", "mjpeg",
            "-f", "image2pipe",
            "pipe:1"
        ]);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Failed to open preview pipe")?;
    let stderr = child.stderr.take().ok_or("Failed to open preview stderr")?;

    // Log preview stderr
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            warn!("Preview FFmpeg: {}", line);
        }
    });

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
                    if b == 0xFF {
                        buffer.push(b);
                    } else if !buffer.is_empty() && buffer[buffer.len()-1] == 0xFF && b == 0xD8 {
                        buffer.push(b);
                        in_frame = true;
                    } else {
                        buffer.clear();
                    }
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
        let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
        stream_state.preview_child.take()
    };
    
    if let Some(mut c) = child {
        let _ = c.kill().await;
    }
    Ok(())
}

fn get_encoder_config(id: &str) -> (String, Vec<&'static str>, String) {
    match id {
        "gpu" => ("h264_vaapi".to_string(), vec!["-rc_mode", "CBR", "-qp", "23"], "VAAPI".to_string()),
        "cpu" => ("libx264".to_string(), vec!["-preset", "ultrafast", "-tune", "zerolatency"], "Software".to_string()),
        _ => ("h264_vaapi".to_string(), vec!["-rc_mode", "CBR", "-qp", "23"], "VAAPI".to_string()),
    }
}

#[tauri::command]
fn get_monitors() -> Vec<MonitorInfo> {
    let mut monitors = Vec::new();

    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
    // Ensure display has .0 for x11grab compatibility
    let base_display = if display.contains('.') { display } else { format!("{}.0", display) };

    monitors.push(MonitorInfo {
        id: "none".to_string(),
        name: "No Monitor (Test Pattern)".to_string(),
        resolution: "1280x720".to_string(),
        is_default: false,
    });

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
                             monitors.push(MonitorInfo {
                                 id: format!("{}+{}", base_display, geom.split('+').nth(1).unwrap_or("0")),
                                 name: format!("Monitor {} ({})", monitor_name, geom.split('+').next().unwrap_or("")),
                                 resolution: geom.split('+').next().unwrap_or("1920x1080").to_string(),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub resolution: String,
    pub is_default: bool,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_audio_devices,
            get_video_devices,
            get_monitors,
            start_stream,
            stop_stream,
            start_preview,
            stop_preview,
            check_twitch_channel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}