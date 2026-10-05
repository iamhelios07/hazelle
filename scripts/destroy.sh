#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run by remote() expand on the machine
# Destroys the hosted machine (infra/), and only after the off-site backup is proven: the newest remote generation
# must have its manifest, be marked copied on the machine, be younger than a day, and restore with scripts/restore.sh
# into a scratch directory on the machine. Then it lifts prevent_destroy for this run (infra/destroy_override.tf,
# removed on exit) and runs terraform destroy, which still asks for confirmation.
#   scripts/destroy.sh
# Needs: terraform state in infra/, VULTR_API_KEY in the shell, ssh as root to the machine, room on the machine's disk
# for one restored copy of the data.
set -euo pipefail
cd "$(dirname "$0")/.."
host=$(terraform -chdir=infra output -raw ip)
remote() { ssh -o BatchMode=yes "root@$host" "$@"; }

remote 'set -eu
  remote=$(sed -n "s/^HAZELLE_BACKUP_REMOTE=//p" /etc/hazelle/env)
  image=$(sed -n "s/^HAZELLE_IMAGE=//p" /etc/hazelle/env)
  rclone() { docker run --rm --user 1000:1000 -e HOME=/tmp -v /etc/hazelle/rclone:/config/rclone -v /var/tmp/hazelle-drill:/drill rclone/rclone:1.75 "$@"; }
  rm -rf /var/tmp/hazelle-drill && mkdir -p /var/tmp/hazelle-drill/data && chown -R 1000:1000 /var/tmp/hazelle-drill
  trap "rm -rf /var/tmp/hazelle-drill" EXIT
  id=$(rclone lsf --dirs-only "$remote" | sed -n "s|^\([0-9]*-[0-9a-f]*\)/$|\1|p" | sort -n | tail -1)
  [ -n "$id" ] || { echo "destroy: no generation on $remote" >&2; exit 1; }
  age_ms=$(( $(date +%s%3N) - ${id%%-*} ))
  [ "$age_ms" -lt 86400000 ] || { echo "destroy: the newest generation $id is $((age_ms / 3600000)) hours old" >&2; exit 1; }
  [ -f "/data/backup/$id/copied" ] || { echo "destroy: $id is not marked copied" >&2; exit 1; }
  rclone copy "$remote/$id" "/drill/$id"
  [ -f "/var/tmp/hazelle-drill/$id/manifest.json" ] || { echo "destroy: $id has no manifest on the remote" >&2; exit 1; }
  grep -o "\"pictures\":\[[^]]*\]" "/var/tmp/hazelle-drill/$id/manifest.json" | grep -o "[0-9a-f]\{64\}" >/var/tmp/hazelle-drill/pictures || true
  rclone copy "$remote/files" /drill/files --files-from-raw /drill/pictures
  docker run --rm --user 1000:1000 --entrypoint /app/scripts/restore.sh -v /var/tmp/hazelle-drill:/drill "$image" "/drill/$id" /drill/data
  echo "destroy: $id restores"' </dev/null

printf '%s\n' \
  'resource "vultr_instance" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' \
  'resource "vultr_reserved_ip" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' >infra/destroy_override.tf
trap 'rm -f infra/destroy_override.tf' EXIT
terraform -chdir=infra destroy
