#!/usr/bin/env bash
# Останавливает процессы, запущенные staging-up.sh.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for pidfile in "${ROOT}"/.staging-logs/*.pid; do
  [ -f "${pidfile}" ] || continue
  pid="$(cat "${pidfile}")"
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" && echo "остановлен $(basename "${pidfile}" .pid) (${pid})"
  fi
  rm -f "${pidfile}"
done
