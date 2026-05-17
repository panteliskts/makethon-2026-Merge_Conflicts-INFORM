#!/usr/bin/env bash
# Start the INFORM MCP server on HTTP and expose it to the internet
# via a Cloudflare quick tunnel (no signup, free, ephemeral URL).
#
# Usage:
#   ./mcp_serve.sh                  # random bearer token, prints registration block
#   INFORM_MCP_TOKEN=mytoken ./mcp_serve.sh
#   INFORM_MCP_PORT=9000 ./mcp_serve.sh
#
# Requirements: cloudflared in PATH (https://github.com/cloudflare/cloudflared)

set -euo pipefail
cd "$(dirname "$0")"

PORT="${INFORM_MCP_PORT:-8765}"
TOKEN="${INFORM_MCP_TOKEN:-$(openssl rand -hex 16)}"
export INFORM_API_URL="${INFORM_API_URL:-http://localhost:8001}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install: https://github.com/cloudflare/cloudflared#installing-cloudflared" >&2
  exit 1
fi

export INFORM_MCP_TRANSPORT=http
export INFORM_MCP_HOST=127.0.0.1
export INFORM_MCP_PORT="$PORT"
export INFORM_MCP_TOKEN="$TOKEN"

PY="${PYTHON:-python}"
[ -x "venv/bin/python" ] && PY="venv/bin/python"

echo "▶ Starting MCP server on http://127.0.0.1:$PORT  (token: $TOKEN)"
"$PY" mcp_server.py &
MCP_PID=$!
trap 'kill $MCP_PID 2>/dev/null || true; kill $TUNNEL_PID 2>/dev/null || true' EXIT

# Wait until /healthz responds — fail fast if the server crashed
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "✓ MCP server healthy"
    break
  fi
  if ! kill -0 $MCP_PID 2>/dev/null; then
    echo "✗ MCP server exited. See logs above." >&2
    exit 1
  fi
  sleep 0.5
done

echo "▶ Opening Cloudflare quick tunnel…"
cloudflared tunnel --url "http://127.0.0.1:$PORT" 2>&1 | tee /tmp/inform_mcp_tunnel.log &
TUNNEL_PID=$!

# Wait for the public URL line to appear
PUBLIC_URL=""
for _ in $(seq 1 30); do
  sleep 1
  PUBLIC_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/inform_mcp_tunnel.log | head -n1 || true)
  [ -n "$PUBLIC_URL" ] && break
done

if [ -z "$PUBLIC_URL" ]; then
  echo "Could not detect public URL. See /tmp/inform_mcp_tunnel.log" >&2
  wait
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────
✅ INFORM MCP is live at: ${PUBLIC_URL}/mcp

Register in any MCP client (.mcp.json / Claude Desktop / Cursor / etc.):

{
  "mcpServers": {
    "inform": {
      "url": "${PUBLIC_URL}/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}

Or for ChatGPT custom connectors / OpenAI Responses API:
  server_url:    ${PUBLIC_URL}/mcp
  authorization: Bearer ${TOKEN}
────────────────────────────────────────────────────────────────────────

EOF

wait
