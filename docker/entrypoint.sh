#!/bin/sh
set -eu

DATA_DIR="${SERAFRAME_DATA_DIR:-/data}"
PORT="${SERAFRAME_PORT:-8080}"

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
    chown -R seraframe:seraframe "$DATA_DIR"
    exec runuser -u seraframe -- uvicorn app.main:create_app --factory --host 0.0.0.0 --port "$PORT"
fi

exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port "$PORT"
