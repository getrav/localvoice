.PHONY: stt-up stt-logs web-up sync-up sync-logs test

stt-up:
	docker compose up -d whisper-stt

stt-logs:
	docker compose logs --tail=120 whisper-stt

web-up:
	docker compose up -d --build web

sync-up:
	docker compose up -d --build 3cx-sync

sync-logs:
	docker compose logs --tail=120 3cx-sync


test:
	./test-services.sh
