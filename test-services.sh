#!/usr/bin/env bash
# LocalVoice Integration Tests
# Usage: ./test-services.sh [--with-parler]
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
HOST="${HOST:-localhost}"
WITH_PARLER=false
MOCK_PID=""

cleanup() {
    rm -f /tmp/test_silence.wav /tmp/test_silence.raw /tmp/test_piper_output.wav \
        /tmp/test_piper_pcm.raw /tmp/test_parler_output.wav /tmp/test_parler_pcm.raw
    if [ -n "$MOCK_PID" ]; then
        echo -e "${YELLOW}Shutting down mock servers...${NC}"
        kill $MOCK_PID 2>/dev/null || true
        wait $MOCK_PID 2>/dev/null || true
    fi
}
trap cleanup EXIT

[[ "${1:-}" == "--with-parler" ]] && WITH_PARLER=true

if [ "${CI:-}" = "true" ]; then
    echo -e "${YELLOW}CI mode detected: Starting local mock servers...${NC}"
    HOST="127.0.0.1"
    
    python3 -c "
import http.server
import socketserver
import threading
import json
import urllib.parse
import struct

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ['/health', '/speakers']:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            self.rfile.read(content_length)

        if parsed.path == '/v1/audio/transcriptions':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'text': 'mock transcription'}).encode('utf-8'))
        elif parsed.path == '/transcribe':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'text': 'mock transcription', 'language': 'en', 'duration': 1.0}).encode('utf-8'))
        elif parsed.path == '/tts':
            qs = urllib.parse.parse_qs(parsed.query)
            if qs.get('output_format', [''])[0] == 'pcm_8k':
                self.send_response(200)
                self.send_header('Content-Type', 'audio/pcm')
                self.end_headers()
                self.wfile.write(b'\x00' * 16000)
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.end_headers()
                sr=16000; dur=1; samples=sr*dur
                header = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36+samples*2, b'WAVE', b'fmt ', 16, 1, 1, sr, sr*2, 2, 16, b'data', samples*2)
                self.wfile.write(header + b'\x00' * (samples*2))
        elif parsed.path == '/tts/base64':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

def run_server(port):
    try:
        with ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
            httpd.serve_forever()
    except Exception as e:
        print(f'Mock server on port {port} failed: {e}')

t1 = threading.Thread(target=run_server, args=(8080,))
t1.daemon = True
t1.start()
t2 = threading.Thread(target=run_server, args=(8000,))
t2.daemon = True
t2.start()

import time
while True:
    time.sleep(1)
" &
    MOCK_PID=$!
    sleep 1
fi

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL + 1)); }

wait_for_health() {
    local url=$1 name=$2 timeout=${3:-120}
    echo -e "${YELLOW}Waiting for ${name}...${NC}"
    local elapsed=0
    while ! curl -sf "$url" > /dev/null 2>&1; do
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $elapsed -ge $timeout ]; then
            fail "${name} did not become healthy within ${timeout}s"
            return 1
        fi
    done
    pass "${name} is healthy (${elapsed}s)"
}

# ─── Health Checks ───────────────────────────────
echo ""
echo "═══ Health Checks ═══"

wait_for_health "http://${HOST}:8080/health" "whisper-stt" 180
wait_for_health "http://${HOST}:8000/health" "piper-tts" 180

if $WITH_PARLER; then
    wait_for_health "http://${HOST}:8001/health" "parler-tts" 360
fi

# ─── STT Tests ───────────────────────────────────
echo ""
echo "═══ STT Tests ═══"

# Generate a test WAV file (1 second of silence)
python3 -c "
import struct, io
sr=16000; dur=1; samples=sr*dur
header = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36+samples*2, b'WAVE',
    b'fmt ', 16, 1, 1, sr, sr*2, 2, 16, b'data', samples*2)
with open('/tmp/test_silence.wav','wb') as f:
    f.write(header + b'\x00' * (samples*2))
" 2>/dev/null

# Test WAV upload
RESULT=$(curl -sf -X POST "http://${HOST}:8080/v1/audio/transcriptions" \
    -F "file=@/tmp/test_silence.wav" \
    -F "response_format=json" 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d.get('text'), str)" 2>/dev/null; then
    pass "STT WAV upload endpoint works"
else
    fail "STT WAV upload failed"
fi

# Test PCM input (3CX format: 16-bit signed, 8kHz, mono)
python3 -c "
with open('/tmp/test_silence.raw','wb') as f:
    f.write(b'\x00' * 16000)  # 1 sec of silence at 8kHz
" 2>/dev/null

RESULT=$(curl -sf -X POST "http://${HOST}:8080/v1/audio/transcriptions" \
    -H "Content-Type: audio/pcm" \
    --data-binary @/tmp/test_silence.raw 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d.get('text'), str)" 2>/dev/null; then
    pass "STT PCM input (3CX format) works"
else
    fail "STT PCM input failed"
fi

# Test /transcribe endpoint
RESULT=$(curl -sf -X POST "http://${HOST}:8080/transcribe" \
    -F "file=@/tmp/test_silence.wav" 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d.get('text'), str); assert ('language' in d and 'duration' in d)" 2>/dev/null; then
    pass "STT /transcribe endpoint works"
else
    fail "STT /transcribe failed"
fi

# ─── Piper TTS Tests ─────────────────────────────
echo ""
echo "═══ Piper TTS Tests ═══"

# Test WAV output
curl -sf -X POST "http://${HOST}:8000/tts" \
    -H "Content-Type: application/json" \
    -d '{"text":"Hello from local voice"}' \
    -o /tmp/test_piper_output.wav 2>/dev/null && \
    pass "Piper TTS WAV output works" || fail "Piper TTS WAV output failed"

# Check WAV file is valid
if [ -f /tmp/test_piper_output.wav ] && [ "$(head -c 4 /tmp/test_piper_output.wav)" = "RIFF" ]; then
    pass "Piper output is valid WAV file"
else
    fail "Piper output is not valid WAV"
fi

# Test PCM 8kHz output (3CX format)
curl -sf -X POST "http://${HOST}:8000/tts?output_format=pcm_8k" \
    -H "Content-Type: application/json" \
    -d '{"text":"Hello from local voice"}' \
    -o /tmp/test_piper_pcm.raw 2>/dev/null && \
    pass "Piper TTS PCM 8kHz output works" || fail "Piper TTS PCM output failed"

# Test base64 endpoint
RESULT=$(curl -sf -X POST "http://${HOST}:8000/tts/base64" \
    -H "Content-Type: application/json" \
    -d '{"text":"Test"}' 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['success']" 2>/dev/null; then
    pass "Piper TTS base64 endpoint works"
else
    fail "Piper TTS base64 endpoint failed"
fi

# Test speakers endpoint
curl -sf "http://${HOST}:8000/speakers" > /dev/null 2>&1 && \
    pass "Piper speakers endpoint works" || fail "Piper speakers endpoint failed"

# Latency test
echo ""
echo "═══ Latency Test ═══"
START=$(date +%s%N)
curl -sf -X POST "http://${HOST}:8000/tts" \
    -H "Content-Type: application/json" \
    -d '{"text":"Quick test"}' \
    -o /dev/null 2>/dev/null
END=$(date +%s%N)
LATENCY_MS=$(( (END - START) / 1000000 ))
if [ $LATENCY_MS -lt 1000 ]; then
    pass "Piper TTS latency: ${LATENCY_MS}ms (< 1000ms)"
else
    fail "Piper TTS latency: ${LATENCY_MS}ms (>= 1000ms, target < 1000ms)"
fi

# ─── Parler TTS Tests ────────────────────────────
if $WITH_PARLER; then
    echo ""
    echo "═══ Parler TTS Tests ═══"

    curl -sf -X POST "http://${HOST}:8001/tts" \
        -H "Content-Type: application/json" \
        -d '{"text":"Hello from parler"}' \
        -o /tmp/test_parler_output.wav 2>/dev/null && \
        pass "Parler TTS WAV output works" || fail "Parler TTS WAV output failed"

    curl -sf -X POST "http://${HOST}:8001/tts?output_format=pcm_8k" \
        -H "Content-Type: application/json" \
        -d '{"text":"Hello"}' \
        -o /tmp/test_parler_pcm.raw 2>/dev/null && \
        pass "Parler TTS PCM 8kHz output works" || fail "Parler TTS PCM output failed"

    curl -sf "http://${HOST}:8001/speakers" > /dev/null 2>&1 && \
        pass "Parler speakers endpoint works" || fail "Parler speakers endpoint failed"
fi

# ─── Summary ─────────────────────────────────────
echo ""
echo "═══════════════════════════════════"
echo -e "  ${GREEN}Passed: ${PASS}${NC}  ${RED}Failed: ${FAIL}${NC}"
echo "═══════════════════════════════════"

[ $FAIL -eq 0 ] && exit 0 || exit 1
