#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV="$ROOT/backend/.env"
FRONTEND_ENV="$ROOT/frontend/.env.local"

read_value() {
  local name="$1"
  local prompt="$2"
  local default="${3:-}"
  local value="${!name:-}"

  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi

  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " value
    printf '%s' "${value:-$default}"
  else
    while [ -z "$value" ]; do
      read -r -p "$prompt: " value
    done
    printf '%s' "$value"
  fi
}

read_secret() {
  local name="$1"
  local prompt="$2"
  local value="${!name:-}"

  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi

  while [ -z "$value" ]; do
    read -r -s -p "$prompt: " value
    echo ""
  done
  printf '%s' "$value"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
  else
    date +%s | shasum -a 256 | awk '{print $1}'
  fi
}

confirm_overwrite() {
  local path="$1"
  if [ -f "$path" ]; then
    local answer=""
    read -r -p "$path already exists. Overwrite it? [y/N]: " answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) echo "Skipped."; exit 0 ;;
    esac
  fi
}

validate_inputs() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required to validate the Supabase URLs." >&2
    exit 1
  fi

  python3 - "$SUPABASE_URL" "$SUPABASE_DB_URL" <<'PY'
import sys
from urllib.parse import urlparse

supabase_url = sys.argv[1].strip()
db_url = sys.argv[2].strip()

project = urlparse(supabase_url)
db = urlparse(db_url)
errors = []

project_host = project.hostname or ""
project_ref = project_host.split(".")[0] if project_host.endswith(".supabase.co") else ""

if project.scheme != "https" or not project_ref:
    errors.append("SUPABASE_URL must look like https://<project-ref>.supabase.co")

if db.scheme not in {"postgresql", "postgres"}:
    errors.append("SUPABASE_DB_URL must start with postgresql://")

db_host = db.hostname or ""
if "pooler.supabase.com" not in db_host:
    errors.append(
        "SUPABASE_DB_URL must be the Session pooler URL from Supabase Dashboard > Connect, "
        "not the direct db.<project-ref>.supabase.co URL."
    )

if db.port not in {5432, 6543}:
    errors.append("SUPABASE_DB_URL should use port 5432 or 6543.")

if not db.username or not db.password:
    errors.append("SUPABASE_DB_URL must include username and password.")

if project_ref and db.username and db.username != f"postgres.{project_ref}":
    errors.append("SUPABASE_DB_URL username should look like postgres.<project-ref>.")

if db.path.strip("/") != "postgres":
    errors.append("SUPABASE_DB_URL database path should be /postgres.")

if errors:
    print("ERROR: invalid Supabase connection settings:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Copy the Session pooler string from Supabase Dashboard > Connect.", file=sys.stderr)
    sys.exit(1)
PY
}

echo "==> Creating local env files for INFORM"
echo "These files stay local and are ignored by Git."
echo ""

confirm_overwrite "$BACKEND_ENV"
confirm_overwrite "$FRONTEND_ENV"

GEMINI_API_KEY="$(read_secret GEMINI_API_KEY "Gemini API key")"
SUPABASE_URL="$(read_value SUPABASE_URL "Supabase project URL")"
SUPABASE_SERVICE_KEY="$(read_secret SUPABASE_SERVICE_KEY "Supabase service role key")"
SUPABASE_DB_URL="$(read_secret SUPABASE_DB_URL "Supabase session pooler DB URL from Dashboard > Connect")"

NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-$(generate_secret)}"
NEXT_PUBLIC_SUPABASE_URL="$(read_value NEXT_PUBLIC_SUPABASE_URL "Frontend Supabase URL" "$SUPABASE_URL")"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(read_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "Supabase publishable/anon key")"
NEXT_PUBLIC_API_BASE_URL="$(read_value NEXT_PUBLIC_API_BASE_URL "Backend API URL" "http://127.0.0.1:8000")"

validate_inputs

mkdir -p "$ROOT/backend" "$ROOT/frontend"
umask 077

cat > "$BACKEND_ENV" <<EOF
GEMINI_API_KEY=$GEMINI_API_KEY
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_EMBED_MODEL=gemini-embedding-001
GEMINI_CHAT_MODEL=gemini-2.5-flash-lite

SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
SUPABASE_DB_URL=$SUPABASE_DB_URL

MAX_TOKENS=512
TOP_K=3
TOP_K_RETRIEVE=20
SCORE_THRESHOLD=0.35
RERANKER_ENABLED=false
MAX_HISTORY_TOKENS=800

MAX_FILE_SIZE_MB=20
UPLOAD_DIR=./uploads
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ADMIN_API_TOKEN=
EOF

cat > "$FRONTEND_ENV" <<EOF
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_ADMIN_API_TOKEN=

NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF

chmod 600 "$BACKEND_ENV" "$FRONTEND_ENV"

echo ""
echo "Created:"
echo "  backend/.env"
echo "  frontend/.env.local"
echo ""
echo "Now run:"
echo "  ./start.sh"
