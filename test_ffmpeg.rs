use std::process::Command;
use std::time::Duration;

fn main() {
    // Test the FFmpeg command generation logic
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-loglevel").arg("info");

    // Add test input - solid black background
    cmd.arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("color=c=black:s=1920x1080:r=30");

    // Add test filter - just copy the video
    cmd.arg("-filter_complex").arg("[0:v]copy[v_end]");

    // Map output
    cmd.arg("-map").arg("[v_end]");
    cmd.arg("-t").arg("1"); // Run for 1 second only
    cmd.arg("-f").arg("null").arg("-");

    println!("Testing FFmpeg command: {:?}", cmd);

    // Execute and check if it works
    match cmd.output() {
        Ok(output) => {
            println!("FFmpeg test succeeded");
            println!("stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("stderr: {}", String::from_utf8_lossy(&output.stderr));
        }
        Err(e) => {
            println!("FFmpeg test failed: {}", e);
        }
    }
}
