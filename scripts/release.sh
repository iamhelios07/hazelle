#!/usr/bin/env bash
# Releases HEAD to the hosted machine in one command:
#   scripts/release.sh v1.2.3
# Tags HEAD, pushes the tag, waits for .github/workflows/release.yml on it, then runs scripts/deploy.sh with the tag.
# While the image builds, deploy.sh --prepare captures the pre-upgrade backup, so the deploy need not wait for one; a
# failed capture leaves it to the deploy.
# Needs what deploy.sh needs, a clean tree whose HEAD is pushed to its upstream (the branch must hold what the release
# is of), and a tag that exists nowhere yet. A failed build leaves the tag in place: the next release takes the next
# version, so the release list says what happened.
set -euo pipefail
cd "$(dirname "$0")/.."
tag=${1:?usage: scripts/release.sh <tag>}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release: $tag is not vX.Y.Z" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "release: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$upstream")" ] || { echo "release: HEAD is not what $upstream holds; push first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
  echo "release: $tag exists already" >&2
  exit 1
fi
git tag "$tag"
git push origin "$tag"
scripts/deploy.sh --prepare &
prepare=$!
# The run appears a few seconds after the push; tag-triggered runs list the tag as their branch.
run=
for _ in $(seq 1 12); do
  run=$(gh run list --workflow=release.yml --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$run" ] && break
  sleep 5
done
[ -n "$run" ] || { echo "release: no build started for $tag within a minute; see gh run list --workflow=release.yml" >&2; exit 1; }
echo "release: building $tag (run $run)"
gh run watch "$run" --exit-status --interval 20 >/dev/null || { echo "release: the build of $tag failed; see gh run view $run --log-failed" >&2; exit 1; }
wait "$prepare" || echo "release: no backup captured ahead; the deploy captures its own" >&2
exec scripts/deploy.sh "$tag"
