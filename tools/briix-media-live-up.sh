#!/bin/bash
# Briix private live transport: static site on :8388 + SSH tunnel :8300 → fonotext-stand:8390.
# Idempotent: safe to run repeatedly. Verdict via /health through the tunnel.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOST_LOCAL="127.0.0.1"

port_busy() { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 1. Static server on 8388 (the live-mode CORS allow-list expects this origin).
if port_busy 8388; then
  if curl -sf -o /dev/null "http://127.0.0.1:8388/index.html"; then
    echo "static: already serving on :8388"
  else
    echo "ERROR: port 8388 is busy by another process" >&2; exit 1
  fi
else
  (cd "$REPO" && nohup python3 -m http.server 8388 --bind 127.0.0.1 >/tmp/briix-live-http.log 2>&1 &)
  sleep 1
  curl -sf -o /dev/null "http://127.0.0.1:8388/index.html" || { echo "ERROR: static server failed" >&2; exit 1; }
  echo "static: started on :8388 (repo root)"
fi

# 2. SSH tunnel 8300 → stand:8390 (ControlMaster socket for clean -O management).
if port_busy 8300; then
  if ssh -S /tmp/briix-live-ssh-control -O check fonotext-stand >/dev/null 2>&1 && curl -s -o /dev/null -m 3 http://127.0.0.1:8300/health; then
    echo "tunnel: already up on :8300"
  else
    echo "ERROR: port 8300 is busy by another process" >&2; exit 1
  fi
else
  ssh -f -N -M -S /tmp/briix-live-ssh-control -L 8300:127.0.0.1:8390 fonotext-stand
  sleep 1
  echo "tunnel: started 127.0.0.1:8300 → fonotext-stand:8390"
fi

# 3. Verdict.
HEALTH=$(curl -sf -m 5 http://127.0.0.1:8300/health || true)
if [ -n "${HEALTH}" ]; then
  echo "health: $HEALTH"
  echo "VERDICT: LIVE READY — open http://127.0.0.1:8388/#/media and включите «Приватный live»"
else
  echo "VERDICT: TUNNEL UP, но media-bff не отвечает по /health — проверь media-bff.service на fonotext-stand"
  exit 2
fi
