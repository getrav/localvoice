#!/bin/bash
set -e

# Create data directories
mkdir -p /data/recordings

# Configure cron schedule from env var
SCHEDULE="${SYNC_CRON_SCHEDULE:-*/15 * * * *}"
echo "$SCHEDULE /app/sync-recordings >> /var/log/sync.log 2>&1" | crontab -

# Create log file
touch /var/log/sync.log

# Run initial sync if requested
if [ "${SYNC_ON_START:-false}" = "true" ]; then
    echo "[$(date)] Running initial sync..."
    /app/sync-recordings 2>&1 | tee -a /var/log/sync.log
fi

echo "[$(date)] Starting cron with schedule: $SCHEDULE"

# Start cron in background and tail log
cron
exec tail -f /var/log/sync.log
