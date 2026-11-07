#!/bin/bash
# Tear down the briix live transport: tunnel on :8300 and static server on :8388.
# Idempotent; kills only processes we recognise (our ssh control socket / our http.server).
set -euo pipefail

# Tunnel: kill the autossh supervisor first (иначе он перезапустит ssh после -O exit).
pkill -f "autossh.*8300" >/dev/null 2>&1 || true
# Then the control socket, then a precise cmdline fallback.
if ssh -S /tmp/briix-live-ssh-control -O check fonotext-stand >/dev/null 2>&1; then
  ssh -S /tmp/briix-live-ssh-control -O exit fonotext-stand >/dev/null 2>&1 || true
fi
if lsof -ti tcp:8300 -sTCP:LISTEN >/dev/null 2>&1; then
  for pid in $(lsof -ti tcp:8300 -sTCP:LISTEN || true); do
    ps -p "$pid" -o command= | grep -q "8300:127.0.0.1:8390" && kill "$pid" || true
  done
  sleep 1
fi
if lsof -ti tcp:8300 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "WARN: :8300 still busy (not ours?)"
else
  echo "tunnel: down"
fi
rm -f /tmp/briix-live-ssh-control

# Static server: our python http.server bound to 8388.
if lsof -ti tcp:8388 -sTCP:LISTEN >/dev/null 2>&1; then
  for pid in $(lsof -ti tcp:8388 -sTCP:LISTEN || true); do
    ps -p "$pid" -o command= | grep -q "http.server 8388" && kill "$pid" || true
  done
  sleep 1
fi
if lsof -ti tcp:8388 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "WARN: :8388 still busy (not ours?)"
else
  echo "static: down"
fi
echo "VERDICT: transport down"
