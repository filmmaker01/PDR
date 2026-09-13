#!/usr/bin/env bash
# Восстановление базы из дампа. Процедура проверяется на staging перед пилотом
# и затем ежемесячно (см. docs/11-testing-quality.md).
set -Eeuo pipefail

KEY="${1:?использование: restore.sh <s3-key|локальный-файл> [target-database-url]}"
TARGET="${2:-${DATABASE_URL:?DATABASE_URL не задан}}"

case "${TARGET}" in
  *pdr_prod*|*production*)
    echo "ОТКАЗ: восстановление в production выполняется вручную, вне этого скрипта." >&2
    exit 1
    ;;
esac

FILE="${KEY}"
if [ ! -f "${FILE}" ]; then
  FILE="/tmp/restore-$(basename "${KEY}")"
  echo "[restore] скачивание s3://${BACKUP_S3_BUCKET}/${KEY}"
  aws s3 cp "s3://${BACKUP_S3_BUCKET}/${KEY}" "${FILE}" --only-show-errors
fi

echo "[restore] восстановление в ${TARGET%%\?*}"
pg_restore --dbname="${TARGET}" --clean --if-exists --no-owner --no-privileges --exit-on-error "${FILE}"

echo "[restore] проверка: количество таблиц"
psql "${TARGET}" -tAc "select count(*) from information_schema.tables where table_schema='public'"
echo "[restore] готово"
