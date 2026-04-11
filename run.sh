#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
bun install

echo "Launching OmniStream Studio..."
bun run tauri dev