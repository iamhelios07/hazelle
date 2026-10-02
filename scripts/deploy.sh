#!/usr/bin/env bash
# Deploys master as GitHub has it: refuses a dirty tree or unpushed commits, runs the checks, prints the recovery
# points, applies remote migrations, deploys, then asks the live site for its session. Lines holding an email are
# dropped from wrangler's output, since the account name contains one.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=./node_modules/.bin
LIVE=https://risu-alpha.risu-alpha.workers.dev

[ "$(git branch --show-current)" = master ] || { echo "deploy: not on master" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "deploy: HEAD differs from origin/master; push first" >&2; exit 1; }

npm run -s check >/dev/null 2>&1 || { echo "deploy: npm run check failed; run it to see why" >&2; exit 1; }
# The recovery points of this run, read before it changes anything, for the deploy note: a deploy that changes a
# Durable Object class cannot be rolled back, and D1 Time Travel restores to a bookmark.
bookmark=$($BIN/wrangler d1 time-travel info risu-alpha 2>&1 | grep -v '@' | grep -i bookmark) || { echo "deploy: could not read the D1 bookmark; nothing applied" >&2; exit 1; }
running=$($BIN/wrangler deployments status 2>&1 | grep -v '@') || { echo "$running" | tail -20 >&2; echo "deploy: could not read the live version; nothing applied" >&2; exit 1; }
echo "before this run: $bookmark"
echo "$running"
# CI=1 takes the confirmation's default (apply) instead of waiting for a key. A failed apply stops here: code
# deployed ahead of its tables fails every request that reaches them.
migrated=$(CI=1 $BIN/wrangler d1 migrations apply risu-alpha --remote 2>&1 | grep -v '@') || { echo "$migrated" | tail -20 >&2; echo "deploy: migrations failed; nothing deployed" >&2; exit 1; }
echo "$migrated" | grep -E 'No migrations|✅' || true
out=$(npm run -s deploy 2>&1 | grep -v '@') || { echo "$out" | tail -20 >&2; exit 1; }
version=$(echo "$out" | sed -n 's/.*Current Version ID: \([0-9a-f]*\).*/\1/p')
session=$(curl -fsS "$LIVE/api/session")
echo "deployed $(git rev-parse --short HEAD) as version ${version:0:8}"
echo "live /api/session: $session"
