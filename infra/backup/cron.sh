#!/bin/sh
# Простой планировщик резервных копий внутри контейнера: раз в сутки в 02:00 UTC.
set -eu
echo "[backup-cron] запущен"
while true; do
  NOW=$(date -u +%H%M)
  if [ "$NOW" = "0200" ]; then
    /bin/sh /app/infra/backup/backup.sh scheduled || echo "[backup-cron] ошибка резервного копирования" >&2
    sleep 3600
  fi
  sleep 60
done
