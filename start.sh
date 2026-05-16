#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

find_python() {
  if command -v "${PYTHON_BIN:-python3}" >/dev/null 2>&1; then
    command -v "${PYTHON_BIN:-python3}"
  elif command -v python >/dev/null 2>&1; then
    command -v python
  else
    echo "ERROR: Python is required but was not found. Install Python 3.11+ and re-run this script." >&2
    exit 1
  fi
}

port_in_use() {
  local host="$1"
  local port="$2"
  local status

  set +e
  python3 -c '
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
family = socket.AF_INET6 if ":" in host else socket.AF_INET
sock = socket.socket(family, socket.SOCK_STREAM)
try:
    sock.bind((host, port))
except PermissionError:
    sys.exit(2)
except OSError:
    sys.exit(0)
else:
    sys.exit(1)
finally:
    sock.close()
' "$host" "$port"
  status=$?
  set -e

  case "$status" in
    0) return 0 ;;
    1) return 1 ;;
    *) lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 ;;
  esac
}

find_free_port() {
  local host="$1"
  local port="$2"
  while port_in_use "$host" "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

cleanup() {
  echo ""
  echo "==> Stopping servers..."
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  echo "Created backend/.env - set your GEMINI_API_KEY before continuing."
  echo "Edit $ROOT/backend/.env then re-run this script."
  exit 1
fi

if grep -q "AIza\.\.\." "$ROOT/backend/.env"; then
  echo "ERROR: backend/.env still has the placeholder key. Set GEMINI_API_KEY first."
  exit 1
fi

if [ ! -f "$ROOT/frontend/.env.local" ]; then
  printf '%s\n' "NEXTAUTH_SECRET=inform-local-demo-secret" > "$ROOT/frontend/.env.local"
  echo "Created frontend/.env.local with local demo auth defaults."
fi

if ! command -v tesseract >/dev/null 2>&1; then
  echo "WARNING: 'tesseract' not found on PATH. Install it before ingesting images:"
  echo "  Debian/Ubuntu/RPi: sudo apt-get install -y tesseract-ocr poppler-utils"
  echo "  macOS:             brew install tesseract poppler"
fi
if ! command -v pdftoppm >/dev/null 2>&1; then
  echo "WARNING: 'pdftoppm' (poppler-utils) not found. PDF rasterization for the OCR model will fail."
fi

REQUESTED_BACKEND_PORT="${BACKEND_PORT:-8000}"
REQUESTED_FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
PYTHON_BIN="$(find_python)"

BACKEND_PORT="$(find_free_port "$BACKEND_HOST" "$REQUESTED_BACKEND_PORT")"
FRONTEND_PORT="$(find_free_port "$FRONTEND_HOST" "$REQUESTED_FRONTEND_PORT")"

if [ "$BACKEND_PORT" != "$REQUESTED_BACKEND_PORT" ]; then
  echo "Backend port $REQUESTED_BACKEND_PORT is in use; using $BACKEND_PORT instead."
fi

if [ "$FRONTEND_PORT" != "$REQUESTED_FRONTEND_PORT" ]; then
  echo "Frontend port $REQUESTED_FRONTEND_PORT is in use; using $FRONTEND_PORT instead."
fi

BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"
FRONTEND_CORS_ORIGINS="${FRONTEND_URL},http://localhost:${FRONTEND_PORT}"

# Backend
echo "==> Starting backend..."
cd "$ROOT/backend"
if [ ! -d "venv" ]; then
  echo "    Creating virtualenv with $PYTHON_BIN..."
  "$PYTHON_BIN" -m venv venv
fi

if [ -f "venv/bin/activate" ]; then
  # macOS/Linux
  source venv/bin/activate
elif [ -f "venv/Scripts/activate" ]; then
  # Windows Git Bash
  source venv/Scripts/activate
else
  echo "ERROR: Could not find the virtualenv activation script in backend/venv." >&2
  echo "Remove backend/venv and re-run ./start.sh." >&2
  exit 1
fi

echo "    Using $(python --version 2>&1)"
echo "    Installing Python packages; first run can take a few minutes..."
python -m pip install -r requirements.txt
CORS_ORIGINS="$FRONTEND_CORS_ORIGINS" uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

# Frontend
echo "==> Starting frontend..."
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  echo "    Installing npm packages; first run can take a few minutes..."
  npm install
fi

if [ -d ".next" ]; then
  echo "    Clearing stale Next.js dev build..."
  rm -rf .next
fi

NEXTAUTH_URL="$FRONTEND_URL" NEXT_PUBLIC_API_BASE_URL="$BACKEND_URL" npm run dev -- --hostname "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo ""
echo "  Backend  -> $BACKEND_URL"
echo "  Frontend -> $FRONTEND_URL"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
