#!/bin/bash

echo "=== OmniStream Studio Test Script ==="
echo ""

# Check .env
echo "1. Checking .env file..."
if [ -f .env ]; then
    echo "   .env exists:"
    cat .env
else
    echo "   ERROR: .env not found"
    exit 1
fi

# Extract values
TWITCH_USERNAME=$(grep "TWITCH_USERNAME" .env | cut -d'=' -f2)
echo "   TWITCH_USERNAME: $TWITCH_USERNAME"

echo ""
echo "2. Testing Twitch API..."
# Try to get channel status via curl
response=$(curl -s -w "\n%{http_code}" \
    -H "Client-ID: jzkbzg6rqtpz8kx6qkx5y5r3s2f20" \
    "https://api.twitch.tv/helix/streams?user_login=$TWITCH_USERNAME")

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)

echo "   HTTP Code: $http_code"
echo "   Response: $body"

if [ "$http_code" = "401" ]; then
    echo "   ERROR: Unauthorized - Client-ID may be invalid or rate-limited"
    echo "   Solution: Register a Twitch app and get your own Client-ID"
elif [ "$http_code" = "200" ]; then
    echo "   SUCCESS: API call works"
    if echo "$body" | grep -q '"data":\s*\[\]'; then
        echo "   Channel is: OFFLINE"
    else
        echo "   Channel is: LIVE"
    fi
fi

echo ""
echo "3. Starting app..."
cd /home/phaylali/Documents/Apps/OmniStreamStudio

# Kill any existing process on port 1420
fuser -k 1420/tcp 2>/dev/null || true
sleep 1

# Build if needed
echo "   Building..."
cd src-tauri && cargo build --release 2>/dev/null &

echo "   Run './run.sh' in another terminal to test"