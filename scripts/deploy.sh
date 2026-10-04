#!/usr/bin/env bash
# Deploys master as GitHub has it: refuses a dirty tree or unpushed commits, runs the checks, prints the recovery
# points, waits until no provider call is live, applies remote migrations, deploys, then asks the live site for its
# session. Lines holding an email are
# dropped from wrangler's output, since the account name contains one.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=./node_modules/.bin
LIVE=https://hazelle.app
began_ms=$(date +%s%3N)

[ "$(git branch --show-current)" = master ] || { echo "deploy: not on master" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "deploy: HEAD differs from origin/master; push first" >&2; exit 1; }

# The cap every other run of the suite gets (CLAUDE.md); the suite once failed here, silently, with none set.
export NODE_OPTIONS=--max-old-space-size=4096
checked=$(npm run -s check 2>&1) || { echo "$checked" | tail -20 >&2; echo "deploy: npm run check failed" >&2; exit 1; }
# The recovery points of this run, read before it changes anything, for the deploy note: a deploy that changes a
# Durable Object class cannot be rolled back, and D1 Time Travel restores to a bookmark.
# The read fails now and then on a fine login (twice on 2026-10-04); a retry answers.
for attempt in 1 2 3; do
  bookmark=$($BIN/wrangler d1 time-travel info risu-alpha 2>&1 | grep -v '@' | grep -i bookmark) && break
  bookmark=
  sleep 5
done
[ -n "$bookmark" ] || { echo "deploy: could not read the D1 bookmark; nothing applied" >&2; exit 1; }
running=$($BIN/wrangler deployments status 2>&1 | grep -v '@') || { echo "$running" | tail -20 >&2; echo "deploy: could not read the live version; nothing applied" >&2; exit 1; }
echo "before this run: $bookmark"
echo "$running"
# A deploy restarts every Durable Object, which cuts each reply being written, so it waits for none (user,
# 2026-10-04): a check every 20 s for up to 10 min. DEPLOY_NOW=1 skips it. A count that fails twice in a row deploys
# anyway, as remote D1 reads flake; the run that applies 0015_live_calls finds no table yet and goes on that way.
if [ "${DEPLOY_NOW:-}" != 1 ]; then
  failed=0
  for ((waited = 0; ; waited += 20)); do
    since=$(($(date +%s%3N) - 15 * 60 * 1000))
    if live=$(CI=1 $BIN/wrangler d1 execute risu-alpha --remote --json --command "SELECT COUNT(*) AS n FROM live_calls WHERE started_at > $since" 2>/dev/null | jq -er '.[0].results[0].n' 2>/dev/null); then
      failed=0
    else
      live=unknown
      failed=$((failed + 1))
    fi
    echo "live calls: $live"
    [ "$live" = 0 ] && break
    [ "$failed" -ge 2 ] && { echo "deploy: live calls unknown twice in a row; deploying without the wait"; break; }
    [ "$waited" -ge 600 ] && { echo "deploy: $live calls still live after 10 min; deploying"; break; }
    sleep 20
  done
fi
# CI=1 takes the confirmation's default (apply) instead of waiting for a key. A failed apply stops here: code
# deployed ahead of its tables fails every request that reaches them.
migrated=$(CI=1 $BIN/wrangler d1 migrations apply risu-alpha --remote 2>&1 | grep -v '@') || { echo "$migrated" | tail -20 >&2; echo "deploy: migrations failed; nothing deployed" >&2; exit 1; }
echo "$migrated" | grep -E 'No migrations|✅' || true
out=$(npm run -s deploy 2>&1 | grep -v '@') || { echo "$out" | tail -20 >&2; exit 1; }
version=$(echo "$out" | sed -n 's/.*Current Version ID: \([0-9a-f]*\).*/\1/p')
# The deploy ended every call that started before this run; their objects never delete their rows.
CI=1 $BIN/wrangler d1 execute risu-alpha --remote --command "DELETE FROM live_calls WHERE started_at < $began_ms" >/dev/null 2>&1 || echo "deploy: could not clear the ended calls from live_calls; the next run's count includes them for up to 15 min"
session=$(curl -fsS "$LIVE/api/session")
echo "deployed $(git rev-parse --short HEAD) as version ${version:0:8}"
echo "live /api/session: $session"
