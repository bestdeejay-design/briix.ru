#!/bin/bash
# Tear down the briix live transport v3: оба туннеля (:8388 demo → 8440, :8300 api → 8390).
# Idempotent; kills only processes we recognise (our ssh control socket / our autossh).
set -euo pipefail

# Tunnel: kill the autossh supervisor first (иначе он перезапустит ssh после -O exit).
pkill -f "autossh.*8388" >/dev/null 2>&1 || true
if ssh -S /tmp/briix-live-ssh-control -O check fonotext-stand >/dev/null 2>&1; then
  ssh -S /tmp/briix-live-ssh-control -O exit fonotext-stand >/dev/null 2>&1 || true
fi
for port in 8388 8300; do
  if lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN || true); do
      ps -p "$pid" -o command= | grep -qE "autossh|ssh" && kill "$pid" || true
    done
    sleep 1
  fi
  if lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "WARN: :$port still busy (not ours?)"
  else
    echo "tunnel: :$port down"
  fi
done
rm -f /tmp/briix-live-ssh-control

echo "VERDICT: transport down"
