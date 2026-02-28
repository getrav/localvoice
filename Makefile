.PHONY: stt-model stt-model-en stt-up stt-logs web-up sync-up sync-logs 3cx-cli test

STT_MODEL ?= small
STT_MODEL_VOLUME ?= localvoice_whisper-models

stt-model:
	docker run --rm --entrypoint /bin/bash \
		-v $(STT_MODEL_VOLUME):/models \
		ghcr.io/ggml-org/whisper.cpp:main-vulkan \
		-lc "./models/download-ggml-model.sh $(STT_MODEL) /models"

stt-model-en:
	docker run --rm --entrypoint /bin/bash \
		-v $(STT_MODEL_VOLUME):/models \
		ghcr.io/ggml-org/whisper.cpp:main-vulkan \
		-lc "./models/download-ggml-model.sh small.en /models"

stt-up:
	docker compose up -d --build whispercpp-backend whispercpp-backend-en whisper-stt

stt-logs:
	docker compose logs --tail=120 whispercpp-backend whispercpp-backend-en whisper-stt

web-up:
	docker compose up -d --build web

sync-up:
	docker compose up -d --build 3cx-sync

sync-logs:
	docker compose logs --tail=120 3cx-sync

3cx-cli:
	docker compose --profile 3cx-cli run --rm 3cx-tools python3 $(CMD)

test:
	./test-services.sh
