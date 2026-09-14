#!/bin/sh
# Точка входа образа API.
#
# На управляемом хостинге нет отдельного шага «накатить миграции»: контейнер
# просто запускают. Поэтому миграции и первичные демо-данные выполняются здесь,
# до старта приложения, и только если это явно разрешено переменными.
#
# В docker compose шаги разделены на отдельные сервисы, поэтому переменные там
# не выставляются и entrypoint сразу запускает процесс.
set -e

cd /app/apps/api

if [ "${RUN_MIGRATIONS_ON_BOOT}" = "true" ]; then
  echo "[entrypoint] применяю миграции"
  npx prisma migrate deploy
fi

# Демо-данные заливаются только в пустую базу: повторный деплой не должен
# стирать то, что успели ввести руками на staging.
if [ "${SEED_DEMO_ON_EMPTY}" = "true" ]; then
  echo "[entrypoint] демо-данные (только если база пуста)"
  SEED_ONLY_IF_EMPTY=true npx tsx prisma/seed-staging.ts
fi

case "${PROCESS_ROLE}" in
  worker) echo "[entrypoint] запускаю worker"; exec node dist/worker.js ;;
  *)      echo "[entrypoint] запускаю API";    exec node dist/main.js ;;
esac
