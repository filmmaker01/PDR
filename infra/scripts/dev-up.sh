#!/usr/bin/env bash
# Локальный запуск: база, хранилище, миграции, сиды.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  echo "[dev] поднимаю postgres и minio в docker"
  docker compose -f infra/docker/compose.local.yml up -d
else
  echo "[dev] docker недоступен — ожидаю локально установленный PostgreSQL"
  pg_isready >/dev/null || { echo "PostgreSQL не запущен"; exit 1; }
  echo "[dev] хранилище файлов: STORAGE_DRIVER=local (каталог storage-local)"
fi

pnpm install
pnpm --filter @pdr/shared build
pnpm --filter @pdr/api db:deploy
pnpm --filter @pdr/api db:seed
echo "[dev] готово. Запуск: pnpm dev"
