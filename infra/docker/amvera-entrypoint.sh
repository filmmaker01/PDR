#!/bin/sh
# Точка входа единого образа для Amvera.
#
# В Amvera один репозиторий = один файл конфигурации, а каждое приложение —
# отдельный проект. Поэтому образ собирается один на всё, а роль процесса
# выбирается переменной окружения PROCESS_ROLE:
#
#   api      API + фоновые задачи (по умолчанию)
#   worker   только фоновые задачи
#   miniapp  статика Mini App через nginx
#   admin    статика админки через nginx
set -e

ROLE="${PROCESS_ROLE:-api}"

# ── Фронтенды ───────────────────────────────────────────────────────────────
# Адрес API попадает в бандл на этапе сборки, а Amvera не пробрасывает
# переменные окружения в сборку. Поэтому при сборке вшивается плейсхолдер,
# а здесь он заменяется на настоящий адрес: сменить домен можно переменной,
# не пересобирая образ.
serve_static() {
  dir="$1"

  if [ -z "${API_URL}" ]; then
    echo "[entrypoint] не задана переменная API_URL — фронтенд не будет знать адрес API" >&2
    exit 1
  fi

  echo "[entrypoint] подставляю API_URL=${API_URL}"
  find "${dir}" -type f \( -name '*.js' -o -name '*.html' \) -exec \
    sed -i "s|__PDR_API_URL__|${API_URL%/}|g; s|__PDR_BOT_USERNAME__|${BOT_USERNAME:-}|g" {} +

  ln -sfn "${dir}" /srv/app
  echo "[entrypoint] nginx отдаёт ${dir}"
  exec nginx -g 'daemon off;'
}

case "${ROLE}" in
  miniapp) serve_static /srv/miniapp ;;
  admin)   serve_static /srv/admin ;;
esac

# ── Backend ─────────────────────────────────────────────────────────────────
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

case "${ROLE}" in
  worker) echo "[entrypoint] запускаю worker"; exec node dist/worker.js ;;
  *)      echo "[entrypoint] запускаю API";    exec node dist/main.js ;;
esac
