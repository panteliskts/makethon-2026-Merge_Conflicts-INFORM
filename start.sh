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

url_host_for_bind_host() {
  case "$1" in
    0.0.0.0|::) echo "127.0.0.1" ;;
    *) echo "$1" ;;
  esac
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
  echo "Created backend/.env from backend/.env.example."
  echo "Set GEMINI_API_KEY before continuing."
  echo "For shared team persistence, also set SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_DB_URL."
  echo "Ask the team lead for the private values; do not commit backend/.env."
  echo "Edit $ROOT/backend/.env then re-run this script."
  exit 1
fi

if grep -Eq "^GEMINI_API_KEY=($|AIza\\.\\.\\.|your-)" "$ROOT/backend/.env"; then
  echo "ERROR: backend/.env is missing GEMINI_API_KEY."
  echo "Ask the team lead for the private backend/.env values, then re-run this script."
  exit 1
fi

if grep -Eq "^SUPABASE_(URL|SERVICE_KEY|DB_URL)=$" "$ROOT/backend/.env"; then
  echo "WARNING: one or more Supabase values are blank in backend/.env."
  echo "         The backend can start in local-only mode, but shared team persistence/storage needs:"
  echo "         SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL"
fi

if [ ! -f "$ROOT/frontend/.env.local" ]; then
  printf '%s\n' "NEXTAUTH_SECRET=inform-local-demo-secret" > "$ROOT/frontend/.env.local"
  echo "Created frontend/.env.local with local demo auth defaults."
fi

REQUESTED_BACKEND_PORT="${BACKEND_PORT:-8000}"
REQUESTED_FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
BACKEND_URL_HOST="${BACKEND_URL_HOST:-$(url_host_for_bind_host "$BACKEND_HOST")}"
FRONTEND_URL_HOST="${FRONTEND_URL_HOST:-$(url_host_for_bind_host "$FRONTEND_HOST")}"
PYTHON_BIN="$(find_python)"

BACKEND_PORT="$(find_free_port "$BACKEND_HOST" "$REQUESTED_BACKEND_PORT")"
FRONTEND_PORT="$(find_free_port "$FRONTEND_HOST" "$REQUESTED_FRONTEND_PORT")"

if [ "$BACKEND_PORT" != "$REQUESTED_BACKEND_PORT" ]; then
  echo "Backend port $REQUESTED_BACKEND_PORT is in use; using $BACKEND_PORT instead."
fi

if [ "$FRONTEND_PORT" != "$REQUESTED_FRONTEND_PORT" ]; then
  echo "Frontend port $REQUESTED_FRONTEND_PORT is in use; using $FRONTEND_PORT instead."
fi

BACKEND_URL="http://${BACKEND_URL_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_URL_HOST}:${FRONTEND_PORT}"
FRONTEND_CORS_ORIGINS="${FRONTEND_URL},http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"

# Backend
cd "$ROOT/backend"
if [ ! -d "venv" ]; then
  echo "Creating Python virtualenv…"
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

python -m pip install -q -r requirements.txt 2>&1 | grep -v "^$\|already satisfied\|notice\|WARNING: pip"
CORS_ORIGINS="$FRONTEND_CORS_ORIGINS" uvicorn app.main:app --reload \
  --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
  --log-level error \
  2>&1 | grep -Ev "^$|Will watch|Started reloader|Started server|Application startup|Uvicorn running|INFO:|WARNING:" &
BACKEND_PID=$!

# Frontend
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing npm packages…"
  npm install --silent
fi

rm -rf .next 2>/dev/null || true

NEXTAUTH_URL="$FRONTEND_URL" NEXT_PUBLIC_API_BASE_URL="$BACKEND_URL" \
  npm run dev -- --hostname "$FRONTEND_HOST" --port "$FRONTEND_PORT" 2>&1 \
  | grep -Ev "^\s*$|○ Compiling|✓ Compiled|✓ Starting|✓ Ready|▲ Next|- Local|- Network|- Environments" &
FRONTEND_PID=$!

echo ""
echo "  Backend  -> $BACKEND_URL (listening on ${BACKEND_HOST}:${BACKEND_PORT})"
echo "  Frontend -> $FRONTEND_URL (listening on ${FRONTEND_HOST}:${FRONTEND_PORT})"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
