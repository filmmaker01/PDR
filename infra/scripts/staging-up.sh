#!/usr/bin/env bash
# Поднимает staging-подобное окружение целиком: база, миграции, демо-данные,
# API, worker и оба фронтенда. Рассчитан на локальную машину и на сервер,
# где уже есть PostgreSQL 16 и Node 22.
#
#   ./infra/scripts/staging-up.sh            # собрать и запустить
#   ./infra/scripts/staging-up.sh --no-seed  # без пересоздания демо-данных
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/apps/api/.env.staging"
SEED=1
[ "${1:-}" = "--no-seed" ] && SEED=0

if [ ! -f "${ENV_FILE}" ]; then
  echo "Нет ${ENV_FILE}. Скопируйте apps/api/.env.staging.example и заполните." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

echo "[staging] база: ${DATABASE_URL%%\?*}"
# psql не понимает параметр schema из строки Prisma — отрезаем query.
DB_URL_CLEAN="${DATABASE_URL%%\?*}"
DB_NAME="${DB_URL_CLEAN##*/}"
ADMIN_URL_DB="${DB_URL_CLEAN%/*}/postgres"
psql "${ADMIN_URL_DB}" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || psql "${ADMIN_URL_DB}" -c "CREATE DATABASE \"${DB_NAME}\"" >/dev/null

echo "[staging] сборка пакетов"
pnpm --filter @pdr/shared build >/dev/null
pnpm --filter @pdr/api exec prisma generate >/dev/null

echo "[staging] миграции"
pnpm --filter @pdr/api exec prisma migrate deploy

if [ "${SEED}" = "1" ]; then
  echo "[staging] демо-данные"
  pnpm --filter @pdr/api seed:staging
fi

echo "[staging] сборка фронтендов"
VITE_API_URL="${PUBLIC_API_URL}" VITE_BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-}" \
  pnpm --filter @pdr/miniapp build >/dev/null
VITE_API_URL="${PUBLIC_API_URL}" VITE_BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-}" \
  pnpm --filter @pdr/admin build >/dev/null

echo "[staging] сборка API"
pnpm --filter @pdr/api build >/dev/null

mkdir -p "${ROOT}/.staging-logs"

start() {
  local name="$1"; shift
  echo "[staging] запуск ${name}"
  ( cd "${ROOT}" && "$@" >"${ROOT}/.staging-logs/${name}.log" 2>&1 & echo $! > "${ROOT}/.staging-logs/${name}.pid" )
}

start api node apps/api/dist/main.js

# Worker поднимается после API: pg-boss создаёт свою схему при первом старте,
# и два процесса, стартующие одновременно, мешают друг другу.
for _ in $(seq 1 30); do
  curl -fsS "${PUBLIC_API_URL}/health/ready" >/dev/null 2>&1 && break
  sleep 1
done
start worker node apps/api/dist/worker.js
start miniapp pnpm --filter @pdr/miniapp exec vite preview --host 0.0.0.0 --port 5173 --strictPort
start admin pnpm --filter @pdr/admin exec vite preview --host 0.0.0.0 --port 5174 --strictPort

sleep 3
echo
echo "Готово:"
echo "  Mini App : ${MINIAPP_URL}"
echo "  Админка  : ${ADMIN_URL}"
echo "  API      : ${PUBLIC_API_URL}/health/ready"
echo "  Логи     : ${ROOT}/.staging-logs"
echo
echo "Вход демо-аккаунтами: откройте Mini App в браузере — появится экран выбора аккаунта."
