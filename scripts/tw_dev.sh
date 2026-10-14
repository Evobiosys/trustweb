#!/usr/bin/env bash
#
# TrustWeb local preview: start (or reuse) the Vite dev server with hot reload, wait until it answers,
# then open the app in its own Chrome window sized like a phone (own profile, so its storage never mixes
# with your everyday browser). Never waits for GitHub, CI or a hosted preview.
#
#   scripts/tw_dev.sh            start or reuse, open the window
#   scripts/tw_dev.sh --lan      bind to the LAN too, so a phone on the same Wi-Fi can open it
#   scripts/tw_dev.sh --no-open  start or reuse only
#   scripts/tw_dev.sh --stop     stop the dev server this script started
#   TW_PORT=5191 scripts/tw_dev.sh   another port (default 5190)
#
# All local previews open as Jakob with his record: TW_DEV_RECORD (a record file, outside the repo) or, when unset, the
# path in ~/.cache/trustweb-dev/dev-record.path seeds every fresh origin instead of the welcome screen (About shows "dev record: <file>").
#
# Local only: no relay or backup proxy is set, so nothing here talks to production services.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${TW_PORT:-5190}"
STATE="$HOME/.cache/trustweb-dev"
LOG="$STATE/vite-$PORT.log"
PIDFILE="$STATE/vite-$PORT.pid"
STOCKPID="$STATE/vite-$PORT-stock.pid"
STOCK_PORT=$((PORT+100))
PROFILE="$STATE/chrome-profile"
URL="http://127.0.0.1:$PORT/"
HOST=127.0.0.1
OPEN=1
mkdir -p "$STATE"
if [ -z "${TW_DEV_RECORD:-}" ] && [ -f "$STATE/dev-record.path" ]; then TW_DEV_RECORD="$(cat "$STATE/dev-record.path")"; fi
export TW_DEV_RECORD="${TW_DEV_RECORD:-}"
# Feature overlay (dev_feature.ts): TW_FEATURE, else feature.json at the worktree root.
if [ -z "${TW_FEATURE:-}" ] && [ -f "$REPO/feature.json" ]; then export TW_FEATURE="$(cat "$REPO/feature.json")"; fi

for arg in "$@"; do
  case "$arg" in
    --lan) HOST=0.0.0.0 ;;
    --no-open) OPEN=0 ;;
    --stop)
      if [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; then echo "stopped dev server on :$PORT"; else echo "no dev server of this script on :$PORT"; fi
      rm -f "$PIDFILE"
      if [ -f "$STOCKPID" ] && kill "$(cat "$STOCKPID")" 2>/dev/null; then echo "stopped stock twin on :$STOCK_PORT"; fi
      rm -f "$STOCKPID"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

answers() { curl -fsS -m 2 -o /dev/null "$URL" 2>/dev/null; }

# Stock twin (no seed, the welcome screen others see) on PORT+100, unless TW_STOCK_URL names another one or this is itself a stock run.
if [ -z "${TW_STOCK:-}" ] && [ -z "${TW_STOCK_URL:-}" ]; then export TW_STOCK_URL="http://127.0.0.1:$STOCK_PORT/"; TWIN=1; else TWIN=0; fi

echo "TrustWeb local preview"
echo "--------"
t0=$(date +%s)
if answers; then
  if [ "$HOST" = 0.0.0.0 ] && lsof -nP -iTCP@127.0.0.1:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "the running dev server listens on loopback only; run scripts/tw_dev.sh --stop, then --lan again" >&2; exit 1
  fi
  echo "reusing the dev server on :$PORT"
else
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $PORT is taken by something that is not answering as the app:" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2; exit 1
  fi
  echo "starting the dev server on $HOST:$PORT (log: $LOG)"
  # A simple command in the background, so $! is Vite itself (for --stop) and nothing holds this script's stdout.
  cd "$REPO/apps/trustweb"
  TW_PORT="$PORT" nohup ../crm/node_modules/.bin/vite --host "$HOST" --strictPort >"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    answers && break
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "the dev server exited; last lines of its log:" >&2; tail -20 "$LOG" >&2; exit 1; fi
    sleep 0.5
  done
  answers || { echo "no answer from $URL after 30 s; last lines of the log:" >&2; tail -20 "$LOG" >&2; exit 1; }
fi
if [ "$TWIN" = 1 ] && ! curl -fsS -m 2 -o /dev/null "$TW_STOCK_URL" 2>/dev/null; then
  cd "$REPO/apps/trustweb"
  TW_STOCK=1 TW_STOCK_URL= TW_PORT="$STOCK_PORT" nohup ../crm/node_modules/.bin/vite --host "$HOST" --strictPort >"$STATE/vite-$PORT-stock.log" 2>&1 </dev/null &
  echo $! >"$STOCKPID"
  cd - >/dev/null
  for _ in $(seq 1 60); do curl -fsS -m 2 -o /dev/null "$TW_STOCK_URL" 2>/dev/null && break; sleep 0.5; done
  echo "stock twin: $TW_STOCK_URL"
fi
echo "ready in $(( $(date +%s) - t0 )) s: $URL"
if [ "$HOST" = 0.0.0.0 ]; then
  echo "on the LAN: http://$(ipconfig getifaddr en0 2>/dev/null || echo '<this-mac-ip>'):$PORT/"
  echo "  plain http on a phone is not a secure context: recording, camera, NFC and crypto.subtle stay off there; look only, or use the dev slot (https)"
fi

branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
head=$(git -C "$REPO" rev-parse --short HEAD)
dirty=$(git -C "$REPO" status --porcelain -- apps packages | wc -l | tr -d ' ')
echo "--------"
echo "branch $branch at $head; $dirty uncommitted file(s) under apps/ and packages/ (the local preview shows them, no hosted preview does)"

if [ "$OPEN" = 1 ]; then
  open -na "Google Chrome" --args --user-data-dir="$PROFILE" --no-first-run --app="$URL" --window-size=430,932
fi
