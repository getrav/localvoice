#!/bin/bash
set -e

# Create data directories
mkdir -p /data/recordings

missing_env=()
[ -z "${THREECX_FQDN:-}" ] && missing_env+=("THREECX_FQDN")
[ -z "${THREECX_CLIENT_ID:-}" ] && missing_env+=("THREECX_CLIENT_ID")
[ -z "${THREECX_CLIENT_SECRET:-}" ] && missing_env+=("THREECX_CLIENT_SECRET")
if [ "${#missing_env[@]}" -ne 0 ]; then
    echo "[3cx-sync] Missing required env var(s): ${missing_env[*]}" >&2
    exit 2
fi

CONFIG_FILE="/data/sync-config.json"
DEFAULT_INTERVAL=5

# Read interval from shared config file, fall back to default
read_interval() {
    if [ -f "$CONFIG_FILE" ]; then
        interval=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('interval_minutes', $DEFAULT_INTERVAL))" 2>/dev/null)
        echo "${interval:-$DEFAULT_INTERVAL}"
    else
        echo "$DEFAULT_INTERVAL"
    fi
}

# Write last_sync_at timestamp to config file (preserve interval_minutes)
write_last_sync() {
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    if [ -f "$CONFIG_FILE" ]; then
        python3 -c "
import json
try:
    c = json.load(open('$CONFIG_FILE'))
except:
    c = {'interval_minutes': $DEFAULT_INTERVAL}
c['last_sync_at'] = '$ts'
json.dump(c, open('$CONFIG_FILE', 'w'))
"
    else
        echo "{\"interval_minutes\": $DEFAULT_INTERVAL, \"last_sync_at\": \"$ts\"}" > "$CONFIG_FILE"
    fi
}

# Create log file
touch /var/log/sync.log

# Run initial sync if requested
if [ "${SYNC_ON_START:-false}" = "true" ]; then
    echo "[$(date)] Running initial sync..."
    /app/sync-recordings 2>&1 | tee -a /var/log/sync.log
    write_last_sync
fi

echo "[$(date)] Starting sync loop (reading interval from $CONFIG_FILE, default ${DEFAULT_INTERVAL}m)"

# Main loop: run sync, write timestamp, sleep for configured interval
while true; do
    INTERVAL=$(read_interval)
    SLEEP_SECS=$((INTERVAL * 60))
    echo "[$(date)] Sleeping ${INTERVAL}m until next sync..." >> /var/log/sync.log
    sleep "$SLEEP_SECS"
    echo "[$(date)] Running sync..." >> /var/log/sync.log
    /app/sync-recordings >> /var/log/sync.log 2>&1 || true
    write_last_sync
done
