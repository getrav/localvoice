FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg cron curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sync-recordings entrypoint.sh ./
RUN chmod +x sync-recordings entrypoint.sh

VOLUME /data

ENTRYPOINT ["/app/entrypoint.sh"]
