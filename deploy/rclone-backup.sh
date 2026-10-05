#!/bin/sh
# The off-site copier (src/server/db/README.md, "The copier's contract"), run in the rclone/rclone image.
#   rclone-backup.sh        a pass now and every hour after
#   rclone-backup.sh once   one pass; exits 1 when a copy or the prune failed
# A pass copies every generation that has manifest.json and no copied marker, writes the marker after each success,
# then prunes the remote. The remote mirrors backup/: <remote>/<id>/ and the picture pool <remote>/files/, where
# scripts/restore.sh looks for the pool.
set -u
LOCAL=/data/backup
REMOTE=${HAZELLE_BACKUP_REMOTE:?set HAZELLE_BACKUP_REMOTE to an rclone remote and path, e.g. r2:hazelle-backup}
RETENTION_MS=$((30 * 24 * 60 * 60 * 1000))

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

pending() {
  for dir in "$LOCAL"/[0-9]*-*; do
    if [ -f "$dir/manifest.json" ] && [ ! -f "$dir/copied" ]; then basename "$dir"; fi
  done
}

# copy, never sync: a generation the app expired locally stays on the remote until prune removes it. The manifest goes
# last, so a remote generation with a manifest holds every file it names.
copy_generation() {
  rclone copy "$LOCAL/$1" "$REMOTE/$1" --exclude manifest.json &&
    rclone copyto "$LOCAL/$1/manifest.json" "$REMOTE/$1/manifest.json" &&
    date -u +%Y-%m-%dT%H:%M:%SZ >"$LOCAL/$1/copied"
}

# Generations older than 30 days go, then every pooled picture no remaining remote manifest names. A listing or a
# manifest that cannot be read stops the pool prune: a picture goes only when every manifest was read.
prune() {
  now_ms=$(($(date +%s) * 1000))
  dirs=$(rclone lsf --dirs-only "$REMOTE") || return 1
  for entry in $dirs; do
    id=${entry%/}
    at=${id%%-*}
    case $at in '' | *[!0-9]*) continue ;; esac
    if [ $((now_ms - at)) -ge "$RETENTION_MS" ]; then
      rclone purge "$REMOTE/$id" || return 1
      log "pruned $id"
    fi
  done
  manifests=$(rclone lsf -R --files-only --include '/*/manifest.json' "$REMOTE") || return 1
  work=$(mktemp -d)
  touch "$work/named"
  for manifest in $manifests; do
    if ! rclone cat "$REMOTE/$manifest" >"$work/manifest" || ! grep -o '"pictures":\[[^]]*\]' "$work/manifest" >"$work/list"; then
      rm -rf "$work"
      return 1
    fi
    grep -o '[0-9a-f]\{64\}' "$work/list" >>"$work/named"
  done
  if ! rclone lsf --files-only "$REMOTE/files" >"$work/pool"; then
    rm -rf "$work"
    return 1
  fi
  sort "$work/pool" -o "$work/pool"
  sort -u "$work/named" | comm -23 "$work/pool" - >"$work/unnamed"
  if [ -s "$work/unnamed" ]; then
    if ! rclone delete "$REMOTE/files" --files-from-raw "$work/unnamed"; then
      rm -rf "$work"
      return 1
    fi
    log "pruned $(wc -l <"$work/unnamed") pictures"
  fi
  rm -rf "$work"
}

pass() {
  ids=$(pending)
  [ -n "$ids" ] || return 0
  # The pool first, so no copied generation names a picture the remote lacks.
  rclone copy "$LOCAL/files" "$REMOTE/files" || { log "pool copy failed; nothing marked"; return 1; }
  failed=0
  for id in $ids; do
    if copy_generation "$id"; then log "copied $id"; else log "copy of $id failed; not marked"; failed=1; fi
  done
  [ "$failed" = 0 ] || return 1
  prune || { log "prune failed"; return 1; }
}

# One pass at a time per container: deploy.sh runs a pass beside the loop's, and a prune that listed the manifests
# before the other pass uploaded one would take that generation's new pictures.
locked_pass() { (flock 9 && pass) 9>/tmp/rclone-backup.lock; }

if [ "${1:-}" = once ]; then
  locked_pass
  exit
fi
trap 'exit 0' TERM INT
while :; do
  locked_pass || log "pass failed; next try in an hour"
  sleep 3600 &
  wait $!
done
