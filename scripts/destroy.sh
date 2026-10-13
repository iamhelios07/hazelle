#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run by remote() expand on the machine
# Destroys the hosted machine (infra/), and only after the off-site backup is proven: the newest remote generation
# must have its manifest, be marked copied on the machine, be younger than a day, and restore with scripts/restore.sh
# into a scratch directory on the machine. Then terraform plans the destroy from a copy of infra/ that lifts
# prevent_destroy, against infra/'s state; after the typed confirmation the generation's age is checked again and the
# saved plan is applied.
#   scripts/destroy.sh
# Needs: terraform initialised in infra/, VULTR_API_KEY in the shell, ssh as root to the machine, and free space on the
# machine's disk, which the live app shares, for the generation as downloaded and as restored plus a fifth of the disk
# (the script adds it up from the manifest and checks it).
set -euo pipefail
cd "$(dirname "$0")/.."
state=$PWD/infra/terraform.tfstate
host=$(terraform -chdir=infra output -raw ip)
remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "root@$host" "$@" </dev/null; }

# Prints the drilled generation's id.
id=$(remote 'set -eu
  remote=$(sed -n "s/^HAZELLE_BACKUP_REMOTE=//p" /etc/hazelle/env)
  image=$(sed -n "s/^HAZELLE_IMAGE=//p" /etc/hazelle/env)
  drill=/var/tmp/hazelle-drill
  rclone() { docker run --rm --user 1000:1000 -e HOME=/tmp -v /etc/hazelle/rclone:/config/rclone -v $drill:/drill rclone/rclone:1.75 "$@"; }
  rm -rf $drill && mkdir -p $drill/data && chown -R 1000:1000 $drill
  trap "rm -rf $drill" EXIT
  listing=$(rclone lsf --dirs-only "$remote") || { echo "destroy: cannot list $remote" >&2; exit 1; }
  id=$(printf "%s\n" "$listing" | sed -n "s|^\([0-9]*-[0-9a-f]\{8\}\)/$|\1|p" | sort -n | tail -1)
  [ -n "$id" ] || { echo "destroy: no generation on $remote" >&2; exit 1; }
  age_ms=$(( $(date +%s%3N) - ${id%%-*} ))
  [ "$age_ms" -ge 0 ] && [ "$age_ms" -lt 86400000 ] ||
    { echo "destroy: the newest generation $id is $((age_ms / 3600000)) hours old" >&2; exit 1; }
  [ -f "/data/backup/$id/copied" ] || { echo "destroy: $id is not marked copied" >&2; exit 1; }
  rclone copyto "$remote/$id/manifest.json" /drill/manifest.json
  grep -Eq "^\{\"version\":[0-9]+,\"id\":\"$id\"," $drill/manifest.json || { echo "destroy: the remote manifest of $id names another generation" >&2; exit 1; }
  grep -q "\"materialized\":" $drill/manifest.json ||
    { echo "destroy: the manifest of $id records no materialized sizes (an older build wrote it); run this after the next daily generation" >&2; exit 1; }
  grep -o "\"pictures\":\[[^]]*\]" $drill/manifest.json | grep -o "[0-9a-f]\{64\}" >$drill/pictures || true
  sum() { grep -o "\"$1\":[0-9]*" $drill/manifest.json | cut -d: -f2 | awk "{ s += \$1 } END { print s + 0 }"; }
  artifacts=$(sum bytes)
  service=$(grep -o "\"service\":{[^}]*}" $drill/manifest.json | grep -o "\"expanded\":[0-9]*" | cut -d: -f2)
  expanded=$((service + $(sum materialized)))
  held=$(sum pictureBytes)
  # No pictures: the remote may have no files/ at all.
  pictures=0
  if [ -s $drill/pictures ]; then
    size=$(rclone size "$remote/files" --files-from-raw /drill/pictures --json)
    pictures=$(echo "$size" | sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p")
  fi
  space=$(df -Pk $drill | awk "NR == 2 { print \$2, \$4 }")
  disk_kb=${space% *}
  free_kb=${space#* }
  # The restore gunzips the service and materializes each account file (expanded: the size of the service and the
  # materialized one of every snapshot, a delta counted with its base, the target of a rewound account as a second
  # file; no apostrophe in this quoted script), copies the
  # snapshots as they are (artifacts, which counts the service gzip too) and copies each picture into every account
  # holding it (held).
  download=$((artifacts + pictures))
  restore=$((expanded + artifacts + held))
  need=$((download + restore + disk_kb * 1024 / 5))
  echo "destroy: $id downloads $download bytes (generation $artifacts, pictures $pictures) and restores to $restore (databases $expanded, snapshots $artifacts, pictures per account $held); the drill needs $need bytes free on $drill with a fifth of the disk, $((free_kb * 1024)) are" >&2
  [ $((free_kb * 1024)) -ge "$need" ] || { echo "destroy: not enough free space for the drill" >&2; exit 1; }
  rclone copy "$remote/$id" "/drill/$id"
  if [ -s $drill/pictures ]; then rclone copy "$remote/files" /drill/files --files-from-raw /drill/pictures; fi
  # The env of the app names the picture store: an r2 generation restores only into it, and without the env the
  # restore looks for a pool beside the generation.
  docker run --rm --user 1000:1000 --env-file /etc/hazelle/env --entrypoint /app/scripts/restore.sh -v $drill:/drill "$image" "/drill/$id" /drill/data >&2
  echo "destroy: $id restores" >&2
  echo "$id"')

fresh() {
  local now_ms age_ms
  now_ms=$(remote 'date +%s%3N')
  age_ms=$((now_ms - ${id%%-*}))
  [ "$age_ms" -ge 0 ] && [ "$age_ms" -lt 86400000 ] ||
    { echo "destroy: generation $id is now $((age_ms / 3600000)) hours old; run this again" >&2; exit 1; }
}

# Beside infra/, so every relative path in the configuration and the variable files resolves as it does there. The guard
# is lifted only in this copy: if a crash leaves it behind, infra/ still refuses a raw terraform destroy.
config=$(mktemp -d "$PWD/.destroy.XXXXXX")
# The saved plan holds the variables and the state, secrets included: outside the repository.
plans=$(mktemp -d)
trap 'rm -rf "$config" "$plans"' EXIT
cp infra/*.tf infra/*.tftpl infra/*.asc infra/.terraform.lock.hcl "$config/"
printf '%s\n' \
  'resource "vultr_instance" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' \
  'resource "vultr_reserved_ip" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' >"$config/destroy_override.tf"
var_files=()
for file in infra/terraform.tfvars infra/*.auto.tfvars; do
  if [ -f "$file" ]; then var_files+=("-var-file=$PWD/$file"); fi
done
tf() { TF_DATA_DIR=$PWD/infra/.terraform terraform -chdir="$config" "$@"; }

tf plan -destroy -input=false -state="$state" "${var_files[@]}" -out="$plans/destroy"
read -r -p "destroy: type destroy to destroy what the plan lists: " answer
[ "$answer" = destroy ] || { echo "destroy: not confirmed; nothing changed" >&2; exit 1; }
fresh
tf apply -input=false -state="$state" -state-out="$state" "$plans/destroy"
