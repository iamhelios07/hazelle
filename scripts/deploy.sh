#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run by remote() expand on the machine
# Deploys a release to the hosted machine by its image digest:
#   scripts/deploy.sh v1.2.3
# Needs: a clean tree with the tag, gh logged in, docker, terraform state in infra/ (for the address), and ssh as root
# to the machine. Order: the release's digest and archive are checked against the tag's commit; the machine pulls the
# image; the running app captures a pre-upgrade backup generation and the copier sends it off-site;
# /etc/hazelle/previous records the running digest and that generation; then the image changes, and the deploy is done
# when the app container runs the selected digest and /api/health answers ok.
# Exit 3: no pre-upgrade backup, nothing changed. Exit 4: the new image is selected but does not run healthy; run this
# again to retry the start, or recover as below.
#
# Recovery, when the new image fails or misbehaves. An image refuses a database newer than it knows, so starting the
# previous digest alone does not work once the new one migrated. As root on the machine:
#   { read -r previous; read -r generation; } </etc/hazelle/previous
#   hazelle-compose down
#   failed=/data.failed-$(date -u +%Y%m%dT%H%M%SZ) && mv /data "$failed"
#   mkdir /data /var/tmp/hazelle-restore && chown 1000:1000 /data /var/tmp/hazelle-restore
#   sed -i "s|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=$previous|" /etc/hazelle/env
#   fetch() { hazelle-compose run --rm --no-deps -v /var/tmp/hazelle-restore:/restore --entrypoint /bin/sh backup -c "$1" "$generation"; }
#   fetch 'rclone copy "$HAZELLE_BACKUP_REMOTE/$0" "/restore/$0"'
#   fetch 'sed -n "s/.*\"pictures\":\[\([^]]*\)\].*/\1/p" "/restore/$0/manifest.json" | tr -d "\"" | tr , "\n" >/tmp/pictures &&
#     rclone copy "$HAZELLE_BACKUP_REMOTE/files" /restore/files --files-from-raw /tmp/pictures'
#   hazelle-compose run --rm --no-deps -v /var/tmp/hazelle-restore:/restore:ro --entrypoint /app/scripts/restore.sh app \
#     "/restore/$generation" /data
#   hazelle-compose up -d && rm -rf /var/tmp/hazelle-restore
# The previous digest is selected before the restore so that its own restore.sh reads the generation. Writes after the
# pre-upgrade generation's snapshots are lost; $failed keeps them until it is removed by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=ghcr.io/jiniill/hazelle
tag=${1:?usage: scripts/deploy.sh <tag>}

[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin tag "$tag"
commit=$(git rev-parse "$tag^{commit}")
host=$(terraform -chdir=infra output -raw ip)
# $1: seconds the call may take. ssh gives up on a dead connection within a minute on its own.
remote() {
  local limit=$1
  shift
  timeout "$limit" ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "root@$host" "$@" </dev/null
}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

gh release download "$tag" -p image-digest.txt -p source.tar.gz -D "$work"
digest=$(cat "$work/image-digest.txt")
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "deploy: image-digest.txt of $tag holds no image digest" >&2; exit 1; }
image="$REPO@$digest"

archive_commit() { gunzip -c "$1" | git get-tar-commit-id; }
[ "$(archive_commit "$work/source.tar.gz")" = "$commit" ] || { echo "deploy: the release's source archive is not $tag's commit" >&2; exit 1; }
docker pull -q --platform linux/amd64 "$image" >/dev/null
container=$(docker create --platform linux/amd64 "$image")
docker cp -q "$container:/app/dist/client/source.tar.gz" "$work/image-source.tar.gz"
docker rm "$container" >/dev/null
[ "$(archive_commit "$work/image-source.tar.gz")" = "$commit" ] || { echo "deploy: $image serves a source archive of another commit" >&2; exit 1; }
echo "deploy: $tag = $commit = $image"

# The functions every remote script starts with. health_ok: the app answers 2xx with "ok":true. wait_healthy <seconds>.
# running <image>: the app container runs that image.
LIB='
health_ok() {
  body=$(timeout 10 hazelle-compose exec -T app wget -qO- -T 5 http://127.0.0.1:8080/api/health 2>/dev/null) &&
    case $body in *"\"ok\":true"*) ;; *) false ;; esac
}
wait_healthy() {
  deadline=$(($(date +%s) + $1))
  until health_ok; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 3
  done
}
running() {
  id=$(hazelle-compose ps -q app) && [ -n "$id" ] &&
    [ "$(docker inspect --format "{{.Config.Image}}" "$id")" = "$1" ] &&
    docker image inspect --format "{{join .RepoDigests \"\n\"}}" "$(docker inspect --format "{{.Image}}" "$id")" | grep -qxF "$1"
}
'

# Asks the running app for a backup generation (node.ts's SIGUSR2 handler), follows its log for the outcome, has the
# copier send the generation off-site and checks its copied marker; 30 minutes in all. Prints the generation id.
# The signal goes from inside the container: Docker's kill API marks a container manually stopped, after which
# restart: unless-stopped no longer restarts it.
CAPTURE='
deadline=$(($(date +%s) + 1800))
app=$(hazelle-compose ps -q app)
count() { docker logs "$app" 2>&1 | grep -c "\"event\":\"backup $1\"" || true; }
# An earlier request still running would log the first "backup finished" after this one was sent.
[ "$(count requested)" -le "$(count finished)" ] || { echo "deploy: an earlier backup request has not finished yet" >&2; exit 1; }
since=$(date +%s.%N)
hazelle-compose exec -T app kill -USR2 1
until line=$(docker logs --since "$since" "$app" 2>&1 | grep -m1 -e "\"event\":\"backup finished\"" -e "\"event\":\"backup refused\""); do
  [ "$(date +%s)" -lt "$deadline" ] || { echo "deploy: the app logged no backup outcome within 30 minutes" >&2; exit 1; }
  sleep 5
done
case $line in *"\"snapshots\":\"ok\""*) ;; *) echo "deploy: backup failed: $line" >&2; exit 1 ;; esac
case $line in *"\"generation\":\"ok\""*) ;; *) echo "deploy: backup failed: $line" >&2; exit 1 ;; esac
generation=$(echo "$line" | sed -n "s/.*\"id\":\"\([0-9]*-[0-9a-f]*\)\".*/\1/p")
[ -n "$generation" ] || { echo "deploy: backup finished without a generation id: $line" >&2; exit 1; }
left=$((deadline - $(date +%s)))
[ "$left" -gt 0 ] && timeout "$left" hazelle-compose exec -T backup /bin/sh /hazelle/rclone-backup.sh once >&2 ||
  { echo "deploy: the copier failed or did not finish within 30 minutes" >&2; exit 1; }
[ -f "/data/backup/$generation/copied" ] || { echo "deploy: generation $generation is not marked copied" >&2; exit 1; }
echo "$generation"
'

selected=$(remote 30 "sed -n 's/^HAZELLE_IMAGE=//p' /etc/hazelle/env")
if [ "$selected" = "$image" ]; then
  # A run that ended with exit 4 left the image selected; this starts it again and checks it the same way.
  remote 400 "set -eu; image=$image; $LIB"'
    running "$image" && health_ok && exit
    hazelle-compose up -d app >&2
    wait_healthy 300 && running "$image"' ||
    { echo "deploy: $image is selected but does not run healthy; see the header for recovery" >&2; exit 4; }
  echo "deploy: $image is selected and runs healthy"
  exit 0
fi

echo "deploy: running $selected"
remote 30 "set -eu; image=$selected; $LIB"'running "$image" && health_ok' ||
  { echo "deploy: the app is not running $selected healthy; nothing changed" >&2; exit 1; }
remote 900 "docker pull -q $image >/dev/null" || { echo "deploy: the machine could not pull $image; nothing changed" >&2; exit 1; }
generation=$(remote 1900 "set -eu; $LIB$CAPTURE") || { echo "deploy: no pre-upgrade backup; nothing changed" >&2; exit 3; }
echo "deploy: pre-upgrade generation $generation is off-site"

remote 300 "set -eu
  printf '%s\n%s\n' '$selected' '$generation' >/etc/hazelle/previous
  sed -i 's|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=$image|' /etc/hazelle/env
  hazelle-compose up -d app" ||
  { echo "deploy: $image is selected but did not start; see the header for recovery" >&2; exit 4; }
remote 400 "set -eu; image=$image; $LIB"'wait_healthy 300 && running "$image"' ||
  { echo "deploy: $image does not run healthy within 5 minutes; see the header for recovery" >&2; exit 4; }
echo "deploy: $tag running as $image (previous $selected, pre-upgrade generation $generation)"
