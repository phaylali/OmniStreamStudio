use log::{error, info};
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

fn detect_gpu_encoder() -> (String, Vec<&'static str>, String) {
    let output = std::process::Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-encoders")
        .output();

    match output {
        Ok(_out) => {
            // Use software encoding - more reliable on this system
            // Need pix_fmt yuv420p to avoid 4:4:4 issues with baseline
            info!("Using software encoder (more reliable)");
            (
                "libx264".to_string(),
                vec!["-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline", "-pix_fmt", "yuv420p"],
                "libx264 (Software)".to_string(),
            )
        }
        Err(e) => {
            error!("Failed to detect encoders: {}", e);
            (
                "libx264".to_string(),
                vec!["-preset", "veryfast", "-profile:v", "baseline", "-pix_fmt", "yuv420p"],
                "libx264".to_string(),
            )
        }
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

#[tauri::command]
async fn start_stream(
    _platform: String,
    url: String,
    keyint: u32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Starting stream to: {} (keyint: {})", url, keyint);

    let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;

    if stream_state.is_live {
        return Err("Stream already running".to_string());
    }

    let (encoder, encoder_args, encoder_name) = detect_gpu_encoder();
    info!("Using encoder: {} ({})", encoder, encoder_name);

    let capture_args = get_capture_args();
    let video_filter = get_video_filter();

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel")
        .arg("info")
        .args(&capture_args)
        .args(video_filter.as_deref().unwrap_or(&[]))
        .args(["-c:v", &encoder])
        .args(&encoder_args)
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
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    info!("FFmpeg command: {:?}", cmd);

    match cmd.spawn() {
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
            info!("Stream process started with {}", encoder_name);
            Ok(format!("Stream started using {}", encoder_name))
        }
        Err(e) => {
            error!("Failed to start ffmpeg: {}", e);
            Err(format!("Failed to start stream: {}", e))
        }
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
            force_stop_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}