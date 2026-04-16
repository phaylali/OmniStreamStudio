#!/bin/bash
# Send follow event to OmniStream Studio
# Usage: ./follow-alert.sh <username>
# Example: ./follow-alert.sh JohnDoe

HOST="localhost"
PORT=6972

USERNAME="${1:-TestUser}"

echo "Sending follow alert for: $USERNAME"

printf '{"type":"follow","data":{"user":"'"$USERNAME"'"}}'"\n" | nc -w1 "$HOST" "$PORT"

echo "Done!"