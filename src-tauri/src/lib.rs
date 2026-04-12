use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{State, Manager};
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};

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

        // Add software encoder first as most reliable fallback
        if output_str.contains("libx264") {
            encoders.push(EncoderInfo {
                id: "libx264".to_string(),
                name: format!("{} (Software)", cpu_name),
                type_: "cpu".to_string(),
            });
        }

        // Check for hardware encoders - add if available in FFmpeg
        let mut gpu_index = 0;
        let mut igpu_index = 0;

        // AMD VCE - can be on multiple GPUs
        if output_str.contains("h264_amf") {
            // Note: AMF availability is checked at runtime in the start_stream function
            // We still show the option so users know it's available, but fallback will work
            for (vendor, gpu_name) in &gpus {
                if vendor == "amd" {
                    let encoder_id = format!("h264_amf_{}", gpu_index);
                    encoders.push(EncoderInfo {
                        id: encoder_id,
                        name: format!("{} (AMD VCE)", gpu_name),
                        type_: "gpu".to_string(),
                    });
                    gpu_index += 1;
                }
            }
            // If no specific GPUs detected but AMF is available, add generic
            if gpu_index == 0 {
                encoders.push(EncoderInfo {
                    id: "h264_amf".to_string(),
                    name: "AMD GPU (VCE)".to_string(),
                    type_: "gpu".to_string(),
                });
            }
        }

        // NVIDIA NVENC - can be on multiple GPUs
        if output_str.contains("h264_nvenc") {
            for (vendor, gpu_name) in &gpus {
                if vendor == "nvidia" {
                    let encoder_id = format!("h264_nvenc_{}", gpu_index);
                    encoders.push(EncoderInfo {
                        id: encoder_id,
                        name: format!("{} (NVENC)", gpu_name),
                        type_: "gpu".to_string(),
                    });
                    gpu_index += 1;
                }
            }
            // If no specific GPUs detected but NVENC is available, add generic
            if gpu_index == 0 {
                encoders.push(EncoderInfo {
                    id: "h264_nvenc".to_string(),
                    name: "NVIDIA GPU (NVENC)".to_string(),
                    type_: "gpu".to_string(),
                });
            }
        }

        // Intel QuickSync - typically integrated GPU
        if output_str.contains("h264_qsv") {
            for (vendor, gpu_name) in &gpus {
                if vendor == "intel" {
                    let encoder_id = format!("h264_qsv_{}", igpu_index);
                    encoders.push(EncoderInfo {
                        id: encoder_id,
                        name: format!("{} (QuickSync)", gpu_name),
                        type_: "igpu".to_string(),
                    });
                    igpu_index += 1;
                }
            }
            // If no specific Intel GPUs detected but QSV is available, add generic
            if igpu_index == 0 {
                encoders.push(EncoderInfo {
                    id: "h264_qsv".to_string(),
                    name: "Intel Integrated GPU (QuickSync)".to_string(),
                    type_: "igpu".to_string(),
                });
            }
        }
    }

    // If no encoders detected, add software as fallback
    if encoders.is_empty() {
        encoders.push(EncoderInfo {
            id: "libx264".to_string(),
            name: "CPU (Software)".to_string(),
            type_: "cpu".to_string(),
        });
    }

    encoders
}

fn test_amf_available() -> bool {
    // Check if AMF runtime library is available by trying to run a simple AMF command
    let test_result = std::process::Command::new("ffmpeg")
        .args([
            "-f", "lavfi",
            "-i", "testsrc=duration=1:size=320x240:rate=1",
            "-c:v", "h264_amf",
            "-f", "null",
            "-",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match test_result {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

#[cfg(target_os = "linux")]
fn get_capture_args() -> Vec<&'static str> {
    vec![
        "-f", "x11grab",
        "-framerate", "30",
        "-draw_mouse", "1",
        "-video_size", "1920x1080",
        "-i", ":0.0",
        "-f", "pulse",
        "-i", "auto",
    ]
}

#[cfg(target_os = "linux")]
fn get_video_filter() -> Option<Vec<&'static str>> {
    Some(vec!["-vf", "scale=1280:720:flags=fast_bilinear"])
}

#[cfg(target_os = "windows")]
fn get_capture_args() -> Vec<&'static str> {
    vec![
        "-f", "gdigrab",
        "-framerate", "30",
        "-i", "desktop",
        "-f", "dshow",
        "-i", "audio=virtual-audio-capture",
    ]
}

#[cfg(target_os = "macos")]
fn get_capture_args() -> Vec<&'static str> {
    vec![
        "-f", "avfoundation",
        "-framerate", "30",
        "-i", "1:0",
    ]
}

fn get_encoder_for_type(encoder_type: &str) -> (String, Vec<&'static str>, String) {
    let encoders = detect_available_encoders();

    // If auto, prefer GPU > iGPU > CPU
    if encoder_type == "auto" {
        // Find best available encoder
        if let Some(encoder) = encoders.iter().find(|e| e.type_ == "gpu") {
            return get_encoder_config(&encoder.id);
        }
        if let Some(encoder) = encoders.iter().find(|e| e.type_ == "igpu") {
            return get_encoder_config(&encoder.id);
        }
        if let Some(encoder) = encoders.iter().find(|e| e.type_ == "cpu") {
            return get_encoder_config(&encoder.id);
        }
    }

    // Match specific type - but only if it's available
    if let Some(encoder) = encoders.iter().find(|e| e.type_ == encoder_type) {
        return get_encoder_config(&encoder.id);
    }

    // Fallback to first available encoder, prefer CPU if available
    if let Some(encoder) = encoders.iter().find(|e| e.type_ == "cpu") {
        return get_encoder_config(&encoder.id);
    }

    // Ultimate fallback
    (
        "libx264".to_string(),
        vec!["-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline", "-pix_fmt", "yuv420p"],
        "libx264 (CPU)".to_string(),
    )
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
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting stream to: {} (keyint: {}, encoder: {})", url, keyint, encoder_type);

    let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;

    if stream_state.is_live {
        return Err("Stream already running".to_string());
    }

    // First try the requested encoder
    let (encoder, encoder_args, encoder_name) = get_encoder_for_type(&encoder_type);
    info!("Using encoder: {} ({})", encoder, encoder_name);

    // Build and try the command
    let result = try_start_stream(&encoder, &encoder_args, &url, keyint);

    match result {
        Ok(mut child) => {
            stream_state.is_live = true;

            if let Some(stderr) = child.stderr.take() {
                let encoder_name_clone = encoder_name.clone();
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stderr).lines();
                    let mut encoder_failed = false;
                    while let Ok(Some(line)) = reader.next_line().await {
                        if line.contains("Failed to create hardware device context") ||
                           line.contains("DLL") && line.contains("failed to open") ||
                           (line.contains("error") || line.contains("Error") || line.contains("failed")) && !encoder_failed {
                            error!("FFmpeg: {}", line);
                            // If hardware encoder fails, log it but don't treat as fatal yet
                            if encoder_name_clone.contains("Hardware") {
                                encoder_failed = true;
                            }
                        } else {
                            info!("FFmpeg: {}", line);
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
            info!("Stream process started with {}", encoder_name);
            Ok(format!("Stream started using {}", encoder_name))
        }
        Err(e) => {
            // If hardware encoder failed, try CPU fallback
            if encoder_name.contains("Hardware") {
                warn!("Hardware encoder {} failed, trying CPU fallback", encoder_name);
                let (cpu_encoder, cpu_args, cpu_name) = (
                    "libx264".to_string(),
                    vec!["-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline", "-pix_fmt", "yuv420p"],
                    "libx264 (CPU)".to_string(),
                );

                match try_start_stream(&cpu_encoder, &cpu_args, &url, keyint) {
                    Ok(mut child) => {
                        stream_state.is_live = true;

                        if let Some(stderr) = child.stderr.take() {
                            tokio::spawn(async move {
                                let mut reader = BufReader::new(stderr).lines();
                                while let Ok(Some(line)) = reader.next_line().await {
                                    if line.contains("error") || line.contains("Error") || line.contains("failed") {
                                        error!("FFmpeg: {}", line);
                                    } else {
                                        info!("FFmpeg: {}", line);
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
                        warn!("Stream started using CPU fallback: {}", cpu_name);
                        Ok(format!("Stream started using CPU fallback: {}", cpu_name))
                    }
                    Err(cpu_e) => {
                        error!("Both hardware and CPU encoders failed. Hardware: {}, CPU: {}", e, cpu_e);
                        Err(format!("Failed to start stream: Hardware encoder failed, CPU fallback also failed"))
                    }
                }
            } else {
                error!("Failed to start ffmpeg: {}", e);
                Err(format!("Failed to start stream: {}", e))
            }
        }
    }
}

fn try_start_stream(encoder: &str, encoder_args: &[&str], url: &str, keyint: u32) -> Result<tokio::process::Child, String> {
    let capture_args = get_capture_args();
    let video_filter = get_video_filter();

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel")
        .arg("info")
        .args(&capture_args)
        .args(video_filter.as_deref().unwrap_or(&[]))
        .args(["-c:v", encoder])
        .args(encoder_args)
        .args([
            "-b:v", "2500k",
            "-maxrate", "3000k",
            "-bufsize", "5000k",
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
        return Err("No username provided".to_string());
    }

    info!("Checking Twitch channel: {}", username);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let response = client
        .get(&format!("https://www.twitch.tv/{}", username))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    
    // Twitch shows user offline page when not live
    // If HTML contains "offlineChannelPage" text, channel is offline
    let is_offline = body.contains("offlineChannelPage") || body.contains("This channel is offline");
    let is_live = !is_offline && (body.contains("isLive") || body.contains("stream"));

    info!("Channel {} is live: {} (offline: {})", username, is_live, is_offline);
    Ok(is_live)
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
            get_available_encoders
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}