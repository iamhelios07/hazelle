#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run by remote() expand on the machine
# Deploys a release to the hosted machine by its image digest:
#   scripts/deploy.sh v1.2.3
# Needs: a clean tree with the tag, gh logged in, docker, terraform state in infra/ (for the address), and ssh as root
# to the machine. Order: the release's digest and archive are checked against the tag's commit; a pre-upgrade backup
# generation is captured and copied off-site; then the image changes, the health route must answer and the running
# container must be the selected digest.
#
# Recovery, when the new image fails or misbehaves. An image refuses a database newer than it knows, so starting the
# previous digest alone does not work once the new one migrated. On the machine, with <previous> and <generation> as
# this run printed them:
#   hazelle-compose stop app
#   mv /data /data.failed && mkdir /data && chown 1000:1000 /data
#   docker run --rm --user 1000:1000 --entrypoint /app/scripts/restore.sh -v /data.failed/backup:/restore:ro \
#     -v /data:/data <previous> /restore/<generation> /data
#   sed -i 's|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=<previous>|' /etc/hazelle/env && hazelle-compose up -d app
# Writes since the pre-upgrade generation are lost; /data.failed keeps them until it is removed by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=ghcr.io/jiniill/hazelle
tag=${1:?usage: scripts/deploy.sh <tag>}

[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin tag "$tag"
commit=$(git rev-parse "$tag^{commit}")
host=$(terraform -chdir=infra output -raw ip)
remote() { ssh -o BatchMode=yes "root@$host" "$@"; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The digest the release workflow recorded in the release notes.
digest=$(gh release view "$tag" --json body --jq .body | grep -o 'sha256:[0-9a-f]\{64\}' | head -1)
[ -n "$digest" ] || { echo "deploy: release $tag records no image digest" >&2; exit 1; }
image="$REPO@$digest"

archive_commit() { gunzip -c "$1" | git get-tar-commit-id; }
gh release download "$tag" -p source.tar.gz -D "$work"
[ "$(archive_commit "$work/source.tar.gz")" = "$commit" ] || { echo "deploy: the release's source archive is not $tag's commit" >&2; exit 1; }
docker pull -q --platform linux/amd64 "$image" >/dev/null
container=$(docker create --platform linux/amd64 "$image")
docker cp -q "$container:/app/dist/client/source.tar.gz" "$work/image-source.tar.gz"
docker rm "$container" >/dev/null
[ "$(archive_commit "$work/image-source.tar.gz")" = "$commit" ] || { echo "deploy: $image serves a source archive of another commit" >&2; exit 1; }
echo "deploy: $tag = $commit = $image"

previous=$(remote "sed -n 's/^HAZELLE_IMAGE=//p' /etc/hazelle/env")
echo "deploy: running $previous"
[ "$previous" != "$image" ] || { echo "deploy: $image is already selected"; exit 0; }

# Asks the running app for a backup generation now, waits for its manifest, has the copier send it off-site and checks
# its copied marker. Prints the generation id.
# Relies on node.ts capturing a generation on SIGUSR2. An image without that handler exits on the signal (Compose
# restarts it) and the wait times out, so nothing is changed.
capture_pre_upgrade_generation() {
  remote 'set -eu
    since=$(date +%s%3N)
    hazelle-compose kill -s SIGUSR2 app >/dev/null
    for _ in $(seq 120); do
      for dir in /data/backup/[0-9]*-*; do
        at=$(basename "$dir"); at=${at%%-*}
        if [ -f "$dir/manifest.json" ] && [ "$at" -ge "$since" ]; then id=$(basename "$dir"); break 2; fi
      done
      sleep 5
    done
    [ -n "${id:-}" ] || { echo "deploy: no generation within 10 minutes" >&2; exit 1; }
    hazelle-compose exec -T backup /bin/sh /hazelle/rclone-backup.sh once >&2
    [ -f "/data/backup/$id/copied" ] || { echo "deploy: generation $id was not copied" >&2; exit 1; }
    echo "$id"' </dev/null
}
generation=$(capture_pre_upgrade_generation) || { echo "deploy: no pre-upgrade generation; nothing changed" >&2; exit 1; }
echo "deploy: pre-upgrade generation $generation is off-site"

remote "sed -i 's|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=$image|' /etc/hazelle/env && hazelle-compose pull -q app && hazelle-compose up -d app"
for _ in $(seq 60); do
  health=$(remote 'hazelle-compose exec -T app wget -qO- http://127.0.0.1:8080/api/health' 2>/dev/null) && break
  sleep 3
done
[ -n "${health:-}" ] || { echo "deploy: /api/health did not answer within 3 minutes; see the header for recovery" >&2; exit 1; }
echo "deploy: health $health"

running=$(remote 'id=$(hazelle-compose ps -q app); docker inspect --format "{{.Config.Image}}" "$id"; docker image inspect --format "{{join .RepoDigests \" \"}}" "$(docker inspect --format "{{.Image}}" "$id")"')
config_image=$(echo "$running" | sed -n 1p)
if [ "$config_image" != "$image" ] || ! echo "$running" | sed -n 2p | tr ' ' '\n' | grep -qx "$image"; then
  echo "deploy: the running container is not $image:" >&2
  echo "$running" >&2
  exit 1
fi
echo "deploy: $tag running as $image (previous $previous, pre-upgrade generation $generation)"
