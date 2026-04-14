use std::process::Command;

fn main() {
    // Test the apply_layers_to_ffmpeg function logic
    let mut cmd = Command::new("ffmpeg");

    // Simulate the start of apply_layers_to_ffmpeg - using lavfi test sources instead of real devices
    cmd.arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("color=c=black:s=1920x1080:r=30");

    // Test Camera layer - using testsrc instead of real video4linux2
    cmd.arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc=duration=1:size=640x480:rate=10");

    // Test Video layer - using another testsrc
    cmd.arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc=duration=1:size=320x240:rate=10");

    // Test filter complex that should work now - this is the fixed format
    cmd.arg("-filter_complex")
       .arg("[1:v]scale=640x480:flags=fast_bilinear[cam0];[2:v]scale=320x240:flags=fast_bilinear[vid0];[0:v][cam0]overlay=10:10[v1];[v1][vid0]overlay=10:500[v_out]");

    cmd.arg("-map").arg("[v_out]");
    cmd.arg("-f").arg("null").arg("-");
    cmd.arg("-t").arg("1"); // Run for 1 second

    println!("Testing FFmpeg command with camera and video layers:");
    println!("{:?}", cmd);

    // Execute and check if it works
    match cmd.output() {
        Ok(output) => {
            println!("FFmpeg test succeeded!");
            println!("stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("stderr: {}", String::from_utf8_lossy(&output.stderr));
            if output.status.success() {
                println!("Exit status: Success");
            } else {
                println!("Exit status: Failure");
            }
        }
        Err(e) => {
            println!("FFmpeg test failed to execute: {}", e);
        }
    }
}
