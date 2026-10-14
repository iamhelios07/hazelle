#!/bin/sh
# One-off, on the hosted machine as root: copies /data/files into the app's R2 picture bucket and checks the bucket
# against account_files (infra/README.md "Pictures in R2"). Needs the rclone remote `files` in
# /etc/hazelle/rclone/rclone.conf, holding the picture bucket's key.
#   move-pictures-to-r2.sh copy <bucket>     copies what the bucket lacks; safe to repeat, also while the app runs
#   move-pictures-to-r2.sh copy-snapshots <bucket>  after deployment, copies missing archives while the app runs
#   move-pictures-to-r2.sh move-snapshots <bucket>  app stopped: copy, verify the catalog, then remove /data/snapshots
#   move-pictures-to-r2.sh verify <bucket>   with the app stopped: every stored picture is in the bucket at its size
set -eu
[ $# = 2 ] || { echo "usage: $0 copy|verify|copy-snapshots|move-snapshots <bucket>" >&2; exit 2; }
bucket=$2

case $1 in
copy-snapshots|move-snapshots)
  if [ "$1" = move-snapshots ]; then
    [ -z "$(hazelle-compose ps -q app)" ] || { echo "stop the app first: hazelle-compose stop app" >&2; exit 1; }
  fi
  if [ -d /data/snapshots ]; then
    hazelle-compose run --rm --no-deps -T --entrypoint rclone backup copy /data/snapshots "files:$bucket/snapshots" --exclude '.tmp-*' --ignore-existing --transfers 4
  fi
  [ "$1" = move-snapshots ] || exit 0
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  hazelle-compose run --rm --no-deps -T --entrypoint node app -e '
    const { DatabaseSync } = require("node:sqlite");
    if (process.env.HAZELLE_FILES_BUCKET !== "r2" || process.env.HAZELLE_FILES_R2_BUCKET !== process.argv[1]) throw new Error("the deployed app must use the destination R2 bucket");
    const db = new DatabaseSync("/data/service.sqlite", { readOnly: true });
    for (const row of db.prepare("SELECT incarnation, id, bytes FROM snapshots").iterate()) console.log(`${row.bytes};${row.incarnation}/${row.id}.sqlite.gz`);
  ' "$bucket" >"$work/stored.raw"
  hazelle-compose run --rm --no-deps -T --entrypoint rclone backup lsf -R --files-only --format sp --separator ';' "files:$bucket/snapshots" >"$work/listed.raw"
  sort "$work/stored.raw" >"$work/stored"
  sort "$work/listed.raw" >"$work/listed"
  comm -23 "$work/stored" "$work/listed" >"$work/wrong"
  if [ -s "$work/wrong" ]; then
    echo "catalogued snapshots missing or wrong-sized; local archives kept:" >&2
    cat "$work/wrong" >&2
    exit 1
  fi
  rm -rf /data/snapshots
  echo "ok: all $(wc -l <"$work/stored") catalogued snapshots verified; local archives removed (older generations keep their hard links)"
  ;;
copy)
  hazelle-compose run --rm --no-deps -T --entrypoint rclone backup copy /data/files "files:$bucket/files" --exclude '.tmp-*' --transfers 16
  ;;
verify)
  # A running app may store a picture between the two listings below.
  [ -z "$(hazelle-compose ps -q app)" ] || { echo "stop the app first: hazelle-compose stop app" >&2; exit 1; }
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  # size;<incarnation>/<id>, the form rclone lists below.
  hazelle-compose run --rm --no-deps -T --entrypoint node app -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync("/data/service.sqlite", { readOnly: true });
    for (const row of db.prepare("SELECT incarnation, id, size FROM account_files WHERE stored = 1").iterate()) console.log(`${row.size};${row.incarnation}/${row.id}`);
  ' >"$work/stored.raw"
  hazelle-compose run --rm --no-deps -T --entrypoint rclone backup lsf -R --files-only --format sp --separator ';' "files:$bucket/files" >"$work/listed.raw"
  # Written to a file first: in a pipe, sh would not stop on a failed read, and an empty list would pass.
  sort "$work/stored.raw" >"$work/stored"
  sort "$work/listed.raw" >"$work/listed"
  comm -23 "$work/stored" "$work/listed" >"$work/wrong"
  if [ -s "$work/wrong" ]; then
    echo "$(wc -l <"$work/wrong") of $(wc -l <"$work/stored") stored pictures are missing from $bucket or differ in size (size;incarnation/id):" >&2
    cat "$work/wrong" >&2
    exit 1
  fi
  echo "ok: all $(wc -l <"$work/stored") stored pictures are in $bucket at their sizes; $(wc -l <"$work/listed") objects listed"
  ;;
*)
  echo "usage: $0 copy|verify|copy-snapshots|move-snapshots <bucket>" >&2
  exit 2
  ;;
esac
