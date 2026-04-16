#!/bin/bash
# Send custom alert to OmniStream Studio
# Usage: ./custom-alert.sh <message> [color]
# Example: ./custom-alert.sh "Hello World!" "#ff0000"

HOST="localhost"
PORT=6972

MESSAGE="${1:-Hello Streamers!}"
COLOR="${2:-#9146ff}"

echo "Sending custom alert: $MESSAGE"

printf '{"type":"custom","data":{"message":"'"$MESSAGE"'"}}'"$\n" | nc -w1 "$HOST" "$PORT"

echo "Done!"