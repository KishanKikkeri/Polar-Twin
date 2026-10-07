#!/usr/bin/env bash
set -euo pipefail

echo "[polartwin] applying database migrations..."
alembic upgrade head

echo "[polartwin] ensuring deterministic seed exists..."
python -m app.seed

echo "[polartwin] starting FastAPI on Render port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
