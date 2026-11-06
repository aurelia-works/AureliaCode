#!/bin/sh
# One parent for a single `bili claude` launch. It records the pid, waits, and exits
# with bili. It does not start a second proxy.
#
# bili stays in the foreground. A background command in a non-interactive shell is given
# /dev/null for stdin, which would drop Claude's chat protocol.
#
# billion-context starts its proxy with detached:true (its own process group) and only
# stops that proxy when Claude exits normally. Closing a chat signals this process
# group, so the proxy would survive. A watcher notes bili's children in other process
# groups, and the exit trap signals those groups. Closing the thread (129, 130, 143)
# is not a failure.
set -u
rec="${AURELIA_COMPRESSION_RECORD:-}"
watcher=
cleaned=
saved_code=

snapshot() {
  [ -n "$rec" ] || return 0
  : > "$rec.kids.tmp"
  for child in $(pgrep -P $$ 2>/dev/null || true); do
    pgrep -P "$child" >> "$rec.kids.tmp" 2>/dev/null || true
  done
  if [ -s "$rec.kids.tmp" ]; then
    mv -f "$rec.kids.tmp" "$rec.kids"
  else
    rm -f "$rec.kids.tmp"
  fi
}

stop_foreign_groups() {
  snapshot
  [ -n "$rec" ] && [ -f "$rec.kids" ] || return 0
  mine=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
  while read -r pid; do
    [ -n "$pid" ] || continue
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$pgid" ] && [ "$pgid" != "$mine" ]; then
      kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done < "$rec.kids"
}

cleanup() {
  # First, before any test: $? is the launch's status and the next command replaces it.
  code=$?
  if [ -n "$cleaned" ]; then
    exit "${saved_code:-1}"
  fi
  cleaned=1
  saved_code=$code
  if [ "$saved_code" -eq 129 ] || [ "$saved_code" -eq 130 ] || [ "$saved_code" -eq 143 ]; then
    saved_code=0
  fi
  stop_foreign_groups
  if [ -n "$watcher" ]; then
    kill -TERM "$watcher" 2>/dev/null || true
  fi
  if [ -n "$rec" ]; then
    rm -f "$rec.pid" "$rec.kids" "$rec.kids.tmp"
    if [ "$saved_code" -ne 0 ]; then
      printf '%s\n' "$saved_code" > "$rec.exit"
    else
      rm -f "$rec.exit"
    fi
  fi
  exit "$saved_code"
}
trap cleanup EXIT INT TERM HUP

if [ -n "$rec" ]; then
  mkdir -p "$(dirname "$rec")" || exit 1
  printf '%s\n' "$$" > "$rec.pid"
  if [ -n "${AURELIA_ACCOUNT:-}" ]; then
    printf '%s\n' "$AURELIA_ACCOUNT" > "$rec.account"
  fi
  (
    while kill -0 $$ 2>/dev/null; do
      : > "$rec.kids.tmp"
      for child in $(pgrep -P $$ 2>/dev/null || true); do
        pgrep -P "$child" >> "$rec.kids.tmp" 2>/dev/null || true
      done
      if [ -s "$rec.kids.tmp" ]; then
        mv -f "$rec.kids.tmp" "$rec.kids"
      else
        rm -f "$rec.kids.tmp"
      fi
      sleep 0.2
    done
  ) &
  watcher=$!
fi

"$@"
