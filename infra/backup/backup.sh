#!/usr/bin/env bash
# Резервная копия базы в S3. Запускается по расписанию и перед каждым выкатом.
set -Eeuo pipefail

LABEL="${1:-scheduled}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/pdr-${LABEL}-${STAMP}.dump"

: "${DATABASE_URL:?DATABASE_URL не задан}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET не задан}"

echo "[backup] дамп ${LABEL} → ${FILE}"
pg_dump --dbname="${DATABASE_URL}" --format=custom --compress=9 --file="${FILE}"

SIZE=$(stat -c%s "${FILE}")
if [ "${SIZE}" -lt 1024 ]; then
  echo "[backup] дамп подозрительно мал (${SIZE} байт)" >&2
  exit 1
fi

KEY="db/$(date -u +%Y/%m)/pdr-${LABEL}-${STAMP}.dump"
echo "[backup] загрузка в s3://${BACKUP_S3_BUCKET}/${KEY} (${SIZE} байт)"
aws s3 cp "${FILE}" "s3://${BACKUP_S3_BUCKET}/${KEY}" --only-show-errors
rm -f "${FILE}"

RETENTION="${BACKUP_RETENTION_DAYS:-30}"
CUTOFF=$(date -u -d "-${RETENTION} days" +%Y-%m-%d)
echo "[backup] удаление копий старше ${CUTOFF}"
aws s3 ls "s3://${BACKUP_S3_BUCKET}/db/" --recursive \
  | awk -v cutoff="${CUTOFF}" '$1 < cutoff {print $4}' \
  | while read -r old; do
      [ -n "${old}" ] && aws s3 rm "s3://${BACKUP_S3_BUCKET}/${old}" --only-show-errors
    done

# Отметка в базе: по ней приложение показывает состояние копий и задача
# backup.verify замечает пропавший бэкап.
if command -v psql >/dev/null 2>&1; then
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO backup_runs (id, label, object_key, size_bytes) \
     VALUES (gen_random_uuid(), '${LABEL}', '${KEY}', ${SIZE})" >/dev/null \
    || echo "[backup] не удалось записать отметку в базу" >&2
else
  echo "[backup] psql недоступен, отметка в базе пропущена" >&2
fi

echo "[backup] готово"
