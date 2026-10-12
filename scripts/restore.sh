#!/usr/bin/env sh
# Restores one backup generation into an empty data directory (src/server/backup/restore.ts), offline: the server must
# not run on the directory until this ends. The pool of pictures sits beside the generation, <generation>/../files, as
# the copier lays it out; fetching a generation from the remote is the copier's. The picture store is the one
# HAZELLE_FILES_BUCKET names, as for the server: a generation captured with the R2 store has no pool and restores only
# into it.
#   scripts/restore.sh <generation directory> <empty data directory>
set -eu
exec node "$(dirname "$0")/../dist/server/restore-cli.js" "$@"
