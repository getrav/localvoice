FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY 3cx-config 3cx-call ./
RUN chmod +x 3cx-config 3cx-call

ENTRYPOINT ["python3"]
