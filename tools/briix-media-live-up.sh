#!/bin/bash
# Briix private live transport v3: два SSH-туннеля к fonotext-stand:
#   :8388 → stand:8440 (демо briix-demo, autodeploy из GitHub Actions)
#   :8300 → stand:8390 (media-bff API)
# Статика больше НЕ served с мака — демо живёт на стенде A (briix-demo.service).
# Idempotent: safe to run repeatedly. Verdict via /health и index.html через туннели.
set -euo pipefail
HOST_LOCAL="127.0.0.1"

port_busy() { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

tunnel_healthy() {
  ssh -S /tmp/briix-live-ssh-control -O check fonotext-stand >/dev/null 2>&1
}

# 1. SSH-туннели (autossh, один мастер на оба форварда).
if port_busy 8388 || port_busy 8300; then
  if tunnel_healthy \
     && curl -sf -o /dev/null -m 3 "http://${HOST_LOCAL}:8388/index.html" \
     && curl -sf -o /dev/null -m 3 "http://${HOST_LOCAL}:8300/health"; then
    echo "tunnel: already up (:8388→8440 demo, :8300→8390 api)"
  else
    echo "ERROR: port 8388/8300 busy by another process (или туннель мёртв — погаси down.sh)" >&2
    exit 1
  fi
else
  # Detached master; autossh -M 0 + ServerAlive* — см. 08.11 root cause #23.
  AUTOSSH_GATETIME=0 autossh -M 0 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o ControlMaster=auto -f -N \
    -S /tmp/briix-live-ssh-control \
    -L 8388:127.0.0.1:8440 -L 8300:127.0.0.1:8390 \
    fonotext-stand >/dev/null 2>&1 </dev/null
  sleep 1
  echo "tunnel: started (autossh) :8388→stand:8440 (demo), :8300→stand:8390 (api)"
fi

# 2. Verdict: демо и шина должны отвечать через туннели.
DEMO_OK=$(curl -sf -m 5 "http://${HOST_LOCAL}:8388/index.html" >/dev/null 2>&1 && echo yes || echo no)
HEALTH=$(curl -sf -m 5 "http://${HOST_LOCAL}:8300/health" || true)
if [ "$DEMO_OK" = "yes" ] && [ -n "${HEALTH}" ]; then
  echo "health: $HEALTH"
  echo "VERDICT: LIVE READY — open http://127.0.0.1:8388/ (демо) и http://127.0.0.1:8388/#/media с «Приватный live»"
else
  [ "$DEMO_OK" != "yes" ] && echo "demo: НЕ отвечает на :8388 — проверь briix-demo.service на fonotext-stand (:8440)" >&2
  [ -z "${HEALTH}" ] && echo "api: media-bff не отвечает по /health — проверь media-bff.service на fonotext-stand" >&2
  exit 2
fi
