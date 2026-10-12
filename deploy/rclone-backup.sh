#!/bin/sh
# The off-site copier (src/server/db/README.md, "The copier's contract"), run in the rclone/rclone image.
#   rclone-backup.sh        a pass now and every hour after
#   rclone-backup.sh once   one pass; exits 1 when a copy or the prune failed
# A pass copies every generation that has manifest.json and no copied marker, writes the marker after each success,
# then prunes the remote. The remote mirrors backup/: <remote>/<id>/ and the picture pool <remote>/files/, where
# scripts/restore.sh looks for the pool.
# One copier per remote prefix: the prune takes every object under it as this machine's, and the lock below serializes
# passes inside one container only.
set -u
LOCAL=/data/backup
REMOTE=${HAZELLE_BACKUP_REMOTE:?set HAZELLE_BACKUP_REMOTE to an rclone remote and path, e.g. r2:hazelle-backup}
# Equals the app's retention (src/server/backup/snapshots.ts). Both sides drop most of a day's generations sooner (prune
# below), the machine only once they are copied here, so the pool prune still finds every kept generation's pictures
# locally or here.
BACKUP_RETENTION_MS=$((7 * 24 * 60 * 60 * 1000))

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

# Prints the picture ids of manifest $1, which must be generation $2's and whole. The pattern follows the key order
# captureGeneration writes (src/server/backup/generation.ts: one line, "pictures" once, "migrations" last), so no
# cut-off prefix of a manifest matches it; a change of that order fails every prune here until this follows it.
pictures() {
  grep -Eq "^\{\"version\":1,\"id\":\"$2\",.*\"pictures\":\[(\"[0-9a-f]{64}\"(,\"[0-9a-f]{64}\")*)?\],\"migrations\":\[[^]]*\]\}\$" "$1" &&
    sed -e 's/.*"pictures":\[\([^]]*\)\],"migrations".*/\1,/' -e 's/"//g' -e 's/,/\n/g' "$1"
}

# Every pooled picture that no remote manifest and no local generation names. Each step is checked: a failed listing,
# read, sort or write, or a manifest that is not whole, returns before anything is deleted.
prune_pool() {
  work=$1
  rclone lsf -R --files-only --include '/*/manifest.json' "$REMOTE" >"$work/manifests" || return 1
  # The local pool holds the pictures of every generation this machine keeps, so a manifest that a lagging listing
  # does not show yet cannot cost its pictures. Assumes no listing lags behind by the retention.
  ls "$LOCAL/files" >"$work/named" || return 1
  while IFS= read -r manifest; do
    rclone cat "$REMOTE/$manifest" >"$work/manifest" || return 1
    pictures "$work/manifest" "${manifest%/manifest.json}" >>"$work/named" || { log "$manifest is not whole"; return 1; }
  done <"$work/manifests"
  # From the root: the remote has no files/ until a generation names a picture, and listing it would fail.
  rclone lsf -R --files-only --include '/files/*' "$REMOTE" >"$work/listed" || return 1
  sed 's|^files/||' "$work/listed" >"$work/pool" || return 1
  sort -u "$work/named" >"$work/named.sorted" || return 1
  sort "$work/pool" >"$work/pool.sorted" || return 1
  comm -23 "$work/pool.sorted" "$work/named.sorted" >"$work/unnamed" || return 1
  [ -s "$work/unnamed" ] || return 0
  rclone delete "$REMOTE/files" --files-from-raw "$work/unnamed" || return 1
  log "pruned $(wc -l <"$work/unnamed") pictures"
}

# A generation goes at the retention, and one with a manifest sooner unless it is one of the two newest with a manifest
# or the newest with a manifest of its UTC day; then the pool. Read from the remote listing alone, so a machine that lost
# its generations never empties the remote. The same rule as expireGenerations (src/server/backup/generation.ts) for a
# copied generation: change both together. One without a manifest is a copy cut off, which the next pass completes.
prune() {
  now_ms=$(($(date +%s) * 1000))
  dirs=$(rclone lsf --dirs-only "$REMOTE") || return 1
  manifests=$(rclone lsf -R --files-only --include '/*/manifest.json' "$REMOTE") || return 1
  whole=0
  days=' '
  for id in $(printf '%s\n' $dirs | sed 's|/$||' | sort -t- -k1,1nr); do
    at=${id%%-*}
    case $at in '' | *[!0-9]*) continue ;; esac
    if [ $((now_ms - at)) -ge "$BACKUP_RETENTION_MS" ]; then
      drop=1
    elif printf '%s\n' $manifests | grep -qx "$id/manifest.json"; then
      day=$((at - at % 86400000))
      drop=1
      if [ "$whole" -lt 2 ]; then drop=0; fi
      case $days in *" $day "*) ;; *) drop=0 ;; esac
      whole=$((whole + 1))
      days="$days$day "
    else
      drop=0
    fi
    if [ "$drop" = 1 ]; then
      rclone purge "$REMOTE/$id" || return 1
      log "pruned $id"
    fi
  done
  work=$(mktemp -d) || return 1
  prune_pool "$work"
  status=$?
  rm -rf "$work"
  return "$status"
}

pass() {
  ids=$(pending)
  if [ -n "$ids" ]; then
    # The pool first, so no copied generation names a picture the remote lacks.
    rclone copy "$LOCAL/files" "$REMOTE/files" || { log "pool copy failed; nothing marked"; return 1; }
    failed=0
    for id in $ids; do
      if copy_generation "$id"; then log "copied $id"; else log "copy of $id failed; not marked"; failed=1; fi
    done
    [ "$failed" = 0 ] || return 1
  fi
  # No pool yet: the app has not begun its first generation, and the remote may not exist.
  [ -d "$LOCAL/files" ] || return 0
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
