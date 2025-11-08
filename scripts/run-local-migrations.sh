#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_COMMAND=${COMPOSE_COMMAND:-docker compose}
DB_PORT="${DB_PORT:-55432}"
DB_USER="${DB_USER:-contentuser}"
DB_PASSWORD="${DB_PASSWORD:-your-secure-password}"
DB_NAME="${DB_NAME:-contenthub}"

if command -v docker >/dev/null 2>&1; then
  cleanup() {
    if [[ "${KEEP_DB:-0}" != "1" ]]; then
      ${COMPOSE_COMMAND} down -v >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT

  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    ${COMPOSE_COMMAND} down -v >/dev/null 2>&1 || true
  fi

  echo "Starting PostgreSQL container (port ${DB_PORT})..."
  DB_PORT="${DB_PORT}" ${COMPOSE_COMMAND} up -d postgres >/dev/null

  CONTAINER_ID="$(${COMPOSE_COMMAND} ps -q postgres)"
  if [[ -z "${CONTAINER_ID}" ]]; then
    echo "Failed to determine postgres container id"
    exit 1
  fi

  echo "Waiting for database readiness..."
  until docker exec "${CONTAINER_ID}" pg_isready -U "${DB_USER}" >/dev/null 2>&1; do
    sleep 2
  done

  DATABASE_URL="${DATABASE_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}}"
  echo "Running migrations using ${DATABASE_URL}"

  (cd "${ROOT_DIR}/src/backend" && DATABASE_URL="${DATABASE_URL}" npm run db:migrate)

  if [[ "${KEEP_DB:-0}" == "1" ]]; then
    trap - EXIT
    echo "KEEP_DB=1 set, leaving database container running."
  fi
else
  echo "Docker not found. Using embedded Postgres for local migrations..."
  node "${ROOT_DIR}/scripts/run-local-migrations-embedded.js"
fi
