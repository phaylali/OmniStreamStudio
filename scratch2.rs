#[tauri::command]
async fn push_stream_chunk(data: Vec<u8>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut stream_state = state.stream.lock().map_err(|e| e.to_string())?;
    if let Some(child) = stream_state.child.as_mut() {
        if let Some(stdin) = child.stdin.as_mut() {
            use tokio::io::AsyncWriteExt;
            stdin.write_all(&data).await.map_err(|e| format!("Write failed: {}", e))?;
        }
    }
    Ok(())
}
