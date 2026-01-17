#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/app/api"
TMP_ROOT="$ROOT_DIR/.tmp"
TMP_API_DIR="$TMP_ROOT/static-api"

restore_api_dir() {
  if [ -d "$TMP_API_DIR" ]; then
    rm -rf "$API_DIR"
    mv "$TMP_API_DIR" "$API_DIR"
  fi
  if [ -d "$TMP_ROOT" ] && [ -z "$(ls -A "$TMP_ROOT" 2>/dev/null)" ]; then
    rmdir "$TMP_ROOT" || true
  fi
}

if [ -d "$API_DIR" ]; then
  mkdir -p "$TMP_ROOT"
  rm -rf "$TMP_API_DIR"
  mv "$API_DIR" "$TMP_API_DIR"
  trap restore_api_dir EXIT
fi

LOCAL_API_MODE=false NEXT_PUBLIC_STATIC_EXPORT=true npm run build
