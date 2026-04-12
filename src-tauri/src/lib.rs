use log::{error, info};
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{State, Manager};
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            is_live: false,
            child: None,
        }
    }
}

pub struct AppState {
    pub stream: Mutex<StreamState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub resolution: String,
    pub is_default: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            stream: Mutex::new(StreamState::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderInfo {
    pub id: String,
    pub name: String,
    pub type_: String,
}

fn detect_gpu_hardware() -> Vec<(String, String)> {
    let mut gpus = Vec::new();

    // Use lspci to detect GPUs
    if let Ok(output) = std::process::Command::new("lspci").output() {
        let lspci_output = String::from_utf8_lossy(&output.stdout);
        for line in lspci_output.lines() {
            if line.contains("VGA compatible controller") {
                // Parse the line: "03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT] (rev c1)"
                if let Some(colon_pos) = line.find(": ") {
                    let device_info = &line[colon_pos + 2..];
                    if device_info.contains("AMD") || device_info.contains("ATI") {
                        // Extract GPU name from the last pair of brackets (the model name)
                        let gpu_name = if let Some(last_start) = device_info.rfind('[') {
                            if let Some(end) = device_info[last_start..].find(']') {
                                device_info[last_start + 1..last_start + end].to_string()
                            } else {
                                "AMD GPU".to_string()
                            }
                        } else {
                            "AMD GPU".to_string()
                        };
                        gpus.push(("amd".to_string(), gpu_name));
                    } else if device_info.contains("NVIDIA") {
                        // For NVIDIA, extract the model name
                        let gpu_name = if let Some(start) = device_info.find('[') {
                            if let Some(end) = device_info[start..].find(']') {
                                device_info[start + 1..start + end].to_string()
                            } else {
                                device_info.split_whitespace().nth(1).unwrap_or("NVIDIA GPU").to_string()
                            }
                        } else {
                            device_info.split_whitespace().nth(1).unwrap_or("NVIDIA GPU").to_string()
                        };
                        gpus.push(("nvidia".to_string(), gpu_name));
                    } else if device_info.contains("Intel") {
                        let gpu_name = device_info.split_whitespace().nth(1).unwrap_or("Intel GPU").to_string();
                        gpus.push(("intel".to_string(), gpu_name));
                    }
                }
            }
        }
    }

    // Try to detect NVIDIA GPUs with nvidia-smi as fallback
    if gpus.iter().find(|(vendor, _)| vendor == "nvidia").is_none() {
        if let Ok(output) = std::process::Command::new("nvidia-smi").args(["--query-gpu=name", "--format=csv,noheader"]).output() {
            let nvidia_output = String::from_utf8_lossy(&output.stdout);
            for line in nvidia_output.lines() {
                if !line.trim().is_empty() {
                    gpus.push(("nvidia".to_string(), line.trim().to_string()));
                }
            }
        }
    }

    gpus
}

fn detect_cpu_info() -> String {
    if let Ok(output) = std::process::Command::new("lscpu").output() {
        let lscpu_output = String::from_utf8_lossy(&output.stdout);
        for line in lscpu_output.lines() {
            if line.contains("Model name:") {
                if let Some(colon_pos) = line.find(':') {
                    return line[colon_pos + 1..].trim().to_string();
                }
            }
        }
    }
    // Fallback: try /proc/cpuinfo
    if let Ok(output) = std::process::Command::new("grep").args(["-m", "1", "model name", "/proc/cpuinfo"]).output() {
        let cpuinfo_output = String::from_utf8_lossy(&output.stdout);
        if let Some(colon_pos) = cpuinfo_output.find(':') {
            return cpuinfo_output[colon_pos + 1..].trim().to_string();
        }
    }
    "CPU".to_string()
}

fn detect_available_encoders() -> Vec<EncoderInfo> {
    let mut encoders = Vec::new();

    let output = std::process::Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-encoders")
        .output();

    if let Ok(output) = output {
        let output_str = String::from_utf8_lossy(&output.stdout);

        // Detect hardware
        let gpus = detect_gpu_hardware();
        let cpu_name = detect_cpu_info();

        let mut gpu_index = 0;
        let mut igpu_index = 0;

        // ── NVIDIA NVENC ──────────────────────────────────────────────────
        if output_str.contains("h264_nvenc") {
            for (_, gpu_name) in gpus.iter().filter(|(v, _)| v == "nvidia") {
                encoders.push(EncoderInfo {
                    id: format!("h264_nvenc_{}", gpu_index),
                    name: format!("{} (NVENC)", gpu_name),
                    type_: "gpu".to_string(),
                });
                gpu_index += 1;
            }
        }

        // ── VAAPI (Linux open-source AMD/Intel) ───────────────────────────
        #[cfg(target_os = "linux")]
        if output_str.contains("h264_vaapi") {
            for (vendor, gpu_name) in &gpus {
                if vendor == "amd" {
                    encoders.push(EncoderInfo {
                        id: format!("h264_vaapi_{}", gpu_index),
                        name: format!("{} (VAAPI)", gpu_name),
                        type_: "gpu".to_string(),
                    });
                    gpu_index += 1;
                } else if vendor == "intel" {
                    encoders.push(EncoderInfo {
                        id: format!("h264_vaapi_{}", igpu_index),
                        name: format!("{} (VAAPI)", gpu_name),
                        type_: "igpu".to_string(),
                    });
                    igpu_index += 1;
                }
            }
        }

        // ── AMD VCE (h264_amf) ────────────────────────────────────────────
        if output_str.contains("h264_amf") {
            for (_, gpu_name) in gpus.iter().filter(|(v, _)| v == "amd") {
                encoders.push(EncoderInfo {
                    id: format!("h264_amf_{}", gpu_index),
                    name: format!("{} (AMD VCE)", gpu_name),
                    type_: "gpu".to_string(),
                });
                gpu_index += 1;
            }
        }

        // ── Intel QuickSync (QSV) ─────────────────────────────────────────
        if output_str.contains("h264_qsv") {
            for (_, gpu_name) in gpus.iter().filter(|(v, _)| v == "intel") {
                encoders.push(EncoderInfo {
                    id: format!("h264_qsv_{}", igpu_index),
                    name: format!("{} (QuickSync)", gpu_name),
                    type_: "igpu".to_string(),
                });
                igpu_index += 1;
            }
        }

        // ── Software fallback (CPU) ───────────────────────────────────────
        if output_str.contains("libx264") {
            encoders.push(EncoderInfo {
                id: "libx264".to_string(),
                name: format!("{} (Software)", cpu_name),
                type_: "cpu".to_string(),
            });
        }
    }

    // Ultimate fallback
    if encoders.is_empty() {
        encoders.push(EncoderInfo {
            id: "libx264".to_string(),
            name: "CPU (Software)".to_string(),
            type_: "cpu".to_string(),
        });
    }

    encoders
}

#[cfg(target_os = "linux")]
fn get_capture_args(monitor_id: &str, resolution: &str, framerate: u32) -> Vec<String> {
    if monitor_id == "none" {
        return vec![
            "-f".to_string(), "lavfi".to_string(),
            "-i".to_string(), format!("testsrc=size=1280x720:rate={}", framerate),
            "-f".to_string(), "pulse".to_string(),
            "-i".to_string(), "auto".to_string(),
        ];
    }
    
    vec![
        "-f".to_string(), "x11grab".to_string(),
        "-framerate".to_string(), framerate.to_string(),
        "-draw_mouse".to_string(), "1".to_string(),
        "-video_size".to_string(), resolution.to_string(),
        "-i".to_string(), monitor_id.to_string(),
        "-f".to_string(), "pulse".to_string(),
        "-i".to_string(), "auto".to_string(),
    ]
}


#[cfg(target_os = "windows")]
fn get_capture_args(_monitor_id: &str, _res: &str, framerate: u32) -> Vec<String> {
    vec![
        "-f".to_string(), "gdigrab".to_string(),
        "-framerate".to_string(), framerate.to_string(),
        "-i".to_string(), "desktop".to_string(),
        "-f".to_string(), "dshow".to_string(),
        "-i".to_string(), "audio=virtual-audio-capture".to_string(),
    ]
}

#[cfg(target_os = "macos")]
fn get_capture_args(_monitor_id: &str, _res: &str, framerate: u32) -> Vec<String> {
    vec![
        "-f".to_string(), "avfoundation".to_string(),
        "-framerate".to_string(), framerate.to_string(),
        "-i".to_string(), "1:0".to_string(),
    ]
}


fn get_encoder_config(encoder_id: &str) -> (String, Vec<&'static str>, String) {
    // Handle indexed encoders (e.g., h264_amf_0, h264_nvenc_1)
    if encoder_id.starts_with("h264_amf") {
        (
            "h264_amf".to_string(),
            vec!["-quality", "balanced"],
            "AMD VCE".to_string(),
        )
    } else if encoder_id.starts_with("h264_nvenc") {
        (
            "h264_nvenc".to_string(),
            vec!["-preset", "fast"],
            "NVIDIA NVENC".to_string(),
        )
    } else if encoder_id.starts_with("h264_qsv") {
        (
            "h264_qsv".to_string(),
            vec!["-preset", "fast"],
            "Intel QuickSync".to_string(),
        )
    } else if encoder_id.starts_with("h264_vaapi") {
        (
            "h264_vaapi".to_string(),
            vec!["-rc_mode", "CBR", "-qp", "23"],
            "VAAPI".to_string(),
        )
    } else {
        // Legacy IDs
        match encoder_id {
            "h264_amf" => (
                "h264_amf".to_string(),
                vec!["-quality", "balanced"],
                "AMD VCE".to_string(),
            ),
            "h264_nvenc" => (
                "h264_nvenc".to_string(),
                vec!["-preset", "fast"],
                "NVIDIA NVENC".to_string(),
            ),
            "h264_qsv" => (
                "h264_qsv".to_string(),
                vec!["-preset", "fast"],
                "Intel QuickSync".to_string(),
            ),
            "h264_vaapi" => (
                "h264_vaapi".to_string(),
                vec!["-rc_mode", "CBR", "-qp", "23"],
                "VAAPI".to_string(),
            ),
            _ => (
                "libx264".to_string(),
                vec!["-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline", "-pix_fmt", "yuv420p"],
                "Software".to_string(),
            ),
        }
    }
}

#[tauri::command]
fn get_available_encoders() -> Vec<EncoderInfo> {
    let encoders = detect_available_encoders();
    info!("Available encoders detected: {:?}", encoders);
    encoders
}



#[tauri::command]
async fn start_stream(
    _platform: String,
    url: String,
    keyint: u32,
    encoder_type: String,
    monitor_id: String,
    resolution: String,
    quality: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting stream to: {} (keyint: {}, encoder: {}, quality: {})", url, keyint, encoder_type, quality);

    {
        let stream_state = state.stream.lock().map_err(|e| e.to_string())?;
        if stream_state.is_live {
            return Err("Stream already running".to_string());
        }
    }

    // Build an ordered cascade of encoders to try.
    // On Linux with open-source AMD driver: VAAPI is first (works), h264_amf second (likely fails).
    // detect_available_encoders() already returns them in the correct priority order.
    let detected = detect_available_encoders();

    let mut cascade: Vec<(String, Vec<&'static str>, String)> = Vec::new();

    if encoder_type == "cpu" {
        // CPU explicitly requested — skip GPU
        cascade.push(get_encoder_config("libx264"));
    } else {
        // Add GPU/iGPU encoders in detection order (VAAPI before h264_amf on Linux)
        let target_types: Vec<&str> = match encoder_type.as_str() {
            "gpu"  => vec!["gpu"],
            "igpu" => vec!["igpu"],
            _      => vec!["gpu", "igpu"],  // "auto" tries all hardware first
        };

        for enc in &detected {
            if target_types.contains(&enc.type_.as_str()) {
                cascade.push(get_encoder_config(&enc.id));
            }
        }

        // Always end with CPU as final fallback
        cascade.push(get_encoder_config("libx264"));
    }

    info!("Encoder cascade ({} options): {:?}",
        cascade.len(),
        cascade.iter().map(|(_, _, n)| n.as_str()).collect::<Vec<_>>());

    // Try each encoder in order — return on first success
    let mut last_error = String::from("No encoders available");

    for (encoder, encoder_args, encoder_name) in &cascade {
        info!("Trying encoder: {} ({})", encoder, encoder_name);

        match try_start_stream(encoder, encoder_args, &url, keyint, &monitor_id, &resolution, &quality) {
            Ok(mut child) => {
                // Wait briefly to see if it fails immediately (e.g. driver issues)
                // We are NOT holding the mutex lock here, so it is safe to await.
                sleep(Duration::from_millis(500)).await;
                
                if let Ok(Some(status)) = child.try_wait() {
                    error!("Encoder {} exited immediately with status: {} — trying next...", encoder_name, status);
                    last_error = format!("{} exited immediately with status: {}", encoder_name, status);
                    continue;
                }

                // Encoder seems stable, update state
                let already_live = {
                    let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
                    if stream_state.is_live {
                        true
                    } else {
                        stream_state.is_live = true;
                        false
                    }
                };

                if already_live {
                    let _ = child.kill().await;
                    return Err("Stream already running".to_string());
                }

                let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;

                let enc_name_log = encoder_name.clone();
                if let Some(stderr) = child.stderr.take() {
                    tokio::spawn(async move {
                        let mut reader = BufReader::new(stderr).lines();
                        while let Ok(Some(line)) = reader.next_line().await {
                            if line.contains("error") || line.contains("Error") || line.contains("failed") {
                                error!("[{}] FFmpeg: {}", enc_name_log, line);
                            } else {
                                info!("[{}] FFmpeg: {}", enc_name_log, line);
                            }
                        }
                    });
                }

                if let Some(stdout) = child.stdout.take() {
                    tokio::spawn(async move {
                        let mut reader = BufReader::new(stdout).lines();
                        while let Ok(Some(line)) = reader.next_line().await {
                            info!("FFmpeg out: {}", line);
                        }
                    });
                }

                stream_state.child = Some(child);
                info!("Stream started successfully with: {}", encoder_name);
                return Ok(format!("Stream started using {}", encoder_name));
            }
            Err(e) => {
                error!("Encoder {} failed: {} — trying next...", encoder_name, e);
                last_error = format!("{}: {}", encoder_name, e);
            }
        }
    }

    error!("All encoders failed. Last error: {}", last_error);
    Err(format!("All encoders failed. Last error: {}", last_error))
}


fn try_start_stream(encoder: &str, encoder_args: &[&str], url: &str, keyint: u32, monitor_id: &str, resolution: &str, quality: &str) -> Result<tokio::process::Child, String> {
    let (target_res, framerate, bitrate) = match quality {
        "720p30" => ("1280x720", 30, "3000k"),
        "1080p60" => ("1920x1080", 60, "6000k"),
        _ => ("1920x1080", 30, "4500k"), // Default 1080p30
    };

    let capture_args = get_capture_args(monitor_id, resolution, framerate);

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel")
        .arg("info");

    // For VAAPI, we need to use hardware acceleration
    if encoder == "h264_vaapi" || encoder.starts_with("h264_vaapi_") {
        // VAAPI device must be declared BEFORE inputs
        cmd.arg("-vaapi_device")
           .arg("/dev/dri/renderD128");

        for arg in &capture_args {
            cmd.arg(arg);
        }

        // VAAPI requires: scale to target size (software), convert to nv12, then hwupload
        cmd.args(["-vf", &format!("scale={}:flags=fast_bilinear,format=nv12,hwupload", target_res.replace("x", ":"))]);

        cmd.args(["-c:v", encoder])
           .args(encoder_args);
    } else {
        for arg in &capture_args {
            cmd.arg(arg);
        }
        cmd.args(["-vf", &format!("scale={}:flags=fast_bilinear", target_res.replace("x", ":"))])
           .args(["-c:v", encoder])
           .args(encoder_args);
    }

    let bufsize = format!("{}k", bitrate.trim_end_matches('k').parse::<u32>().unwrap_or(4500) * 2);

    cmd.args([
            "-b:v", bitrate,
            "-maxrate", bitrate,
            "-bufsize", &bufsize,
            "-r", &framerate.to_string(),
            "-g", &keyint.to_string(),
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2",
            "-f", "flv",
            "-rtmp_flashver", "FMLE/3.0",
            "-rtmp_live", "live",
            "-y",
            url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    info!("FFmpeg command: {:?}", cmd);

    match cmd.spawn() {
        Ok(child) => Ok(child),
        Err(e) => Err(format!("Failed to spawn ffmpeg: {}", e))
    }
}

#[tauri::command]
async fn stop_stream(state: State<'_, AppState>) -> Result<(), String> {
    info!("Stopping stream");

    let child = {
        let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
        if !stream_state.is_live {
            return Ok(());
        }
        stream_state.is_live = false;
        stream_state.child.take()
    };

    if let Some(mut child) = child {
        let _ = child.kill().await;
    }

    info!("Stream stopped");
    Ok(())
}

#[tauri::command]
fn get_stream_status(state: State<'_, AppState>) -> Result<bool, String> {
    let stream_state = state.stream.lock().map_err(|e| e.to_string())?;
    Ok(stream_state.is_live)
}

#[tauri::command]
async fn force_stop_stream(state: State<'_, AppState>) -> Result<(), String> {
    info!("Force stopping stream...");
    
    // Kill any ffmpeg process streaming to RTMP
    let _ = std::process::Command::new("pkill")
        .args(["-f", "ffmpeg.*rtmps"])
        .spawn();
    
    // Also try to kill any ffmpeg process
    let _ = std::process::Command::new("pkill")
        .args(["-f", "ffmpeg"])
        .spawn();
    
    if let Ok(mut stream_state) = state.stream.lock() {
        stream_state.is_live = false;
        stream_state.child = None;
    }
    
    info!("Stream force stopped");
    Ok(())
}

#[tauri::command]
async fn check_twitch_channel(username: String, _client_id: String) -> Result<bool, String> {
    if username.is_empty() {
        return Ok(false);
    }

    info!("Checking Twitch channel via Bun Sidecar: {}", username);

    // Get the current directory to build an absolute path to the script
    let mut script_path = std::env::current_dir().unwrap_or_default();
    script_path.push("scripts");
    script_path.push("status.ts");

    // Delegate to Bun which handles the modern web session much better than curl/reqwest for Twitch
    match std::process::Command::new("bun")
        .arg(&script_path)
        .arg(&username)
        .output() {
            Ok(output) => {
                let bun_out = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let bun_err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                
                if !bun_err.is_empty() {
                    warn!("Bun Sidecar Stderr: {}", bun_err);
                }
                
                let is_live = bun_out == "true";
                info!("Bun Sidecar Result for {}: live={} (out: '{}')", username, is_live, bun_out);
                return Ok(is_live);
            },
            Err(e) => {
                error!("Failed to execute Bun Sidecar: {} (Path: {:?})", e, script_path);
            }
        }

    Ok(false)
}

#[tauri::command]
fn get_monitors() -> Vec<MonitorInfo> {
    let mut monitors = Vec::new();
    
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
                        
                        // Look for the geometry part: e.g., "1920/521x1080/293+0+1050"
                        if let Some(geom) = parts.iter().find(|p| p.contains('x') && p.contains('+')) {
                            // Split into size and offset
                            let plus_parts: Vec<&str> = geom.split('+').collect();
                            if plus_parts.len() >= 3 {
                                let size_part = plus_parts[0]; // "1920/521x1080/293"
                                let offset_x = plus_parts[1]; // "0"
                                let offset_y = plus_parts[2]; // "1050"
                                
                                // Parse size "1920/521x1080/293"
                                let dimensions: Vec<&str> = size_part.split('x').collect();
                                if dimensions.len() == 2 {
                                    let w = dimensions[0].split('/').next().unwrap_or("1920");
                                    let h = dimensions[1].split('/').next().unwrap_or("1080");
                                    let res = format!("{}x{}", w, h);
                                    
                                    monitors.push(MonitorInfo {
                                        id: format!(":0.0+{},{}", offset_x, offset_y),
                                        name: format!("Monitor {} ({})", monitor_name, res),
                                        resolution: res,
                                        is_default: is_primary,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if monitors.len() == 1 {
        monitors.push(MonitorInfo {
            id: ":0.0".to_string(),
            name: "Default Screen (:0.0)".to_string(),
            resolution: "1920x1080".to_string(),
            is_default: true,
        });
    }

    monitors
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    
    info!("OmniStream Studio starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        info!("Window closing, stopping stream...");
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            if let Ok(mut stream_state) = state.stream.lock() {
                                if stream_state.is_live {
                                    let _ = std::process::Command::new("pkill")
                                        .args(["-f", "ffmpeg.*rtmps"])
                                        .spawn();
                                    stream_state.is_live = false;
                                }
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_stream,
            stop_stream,
            get_stream_status,
            check_twitch_channel,
            force_stop_stream,
            get_available_encoders,
            get_monitors
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}