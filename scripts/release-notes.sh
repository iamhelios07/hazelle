#!/usr/bin/env bash
# The commits a release adds since the previous tag, by commit type, as Markdown:
#   scripts/release-notes.sh v1.2.3       (a tag, or HEAD for the release about to be tagged)
# The release workflow puts it in the GitHub release; the deploy skill drafts the release's 소식 post (server/news) from it.
# refactor, chore, test, docs and style change nothing a user meets and are left out; a subject with no known type is
# kept under 기타 rather than lost.
set -euo pipefail
cd "$(dirname "$0")/.."
to=${1:?usage: scripts/release-notes.sh <tag|HEAD>}
from=$(git describe --tags --abbrev=0 --match 'v*' "$to^")
subjects=$(git log --no-merges --format=%s "$from..$to")
echo "$from 이후"
for group in 'feat:기능' 'fix:수정' 'design:화면' 'perf:속도' ':기타'; do
  type=${group%%:*}
  if [ -n "$type" ]; then
    lines=$(grep -E "^$type(\(.*\))?: " <<<"$subjects" | sed -E 's/^[a-z]+(\([^)]*\))?: //' || true)
  else
    lines=$(grep -vE '^(feat|fix|design|perf|refactor|chore|test|docs|style)(\(.*\))?: ' <<<"$subjects" || true)
  fi
  [ -n "$lines" ] || continue
  printf '\n## %s\n\n' "${group#*:}"
  sed 's/^/- /' <<<"$lines"
done
