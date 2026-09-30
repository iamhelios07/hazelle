#!/usr/bin/env bash
# Deploys master as GitHub has it: refuses a dirty tree or unpushed commits, runs the checks, applies remote
# migrations, deploys, then asks the live site for its session. Lines holding an email are dropped from wrangler's
# output, since the account name contains one.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=./node_modules/.bin
LIVE=https://risu-alpha.risu-alpha.workers.dev

[ "$(git branch --show-current)" = master ] || { echo "deploy: not on master" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "deploy: HEAD differs from origin/master; push first" >&2; exit 1; }

npm run -s check >/dev/null 2>&1 || { echo "deploy: npm run check failed; run it to see why" >&2; exit 1; }
# CI=1 takes the confirmation's default (apply) instead of waiting for a key.
CI=1 $BIN/wrangler d1 migrations apply risu-alpha --remote 2>&1 | grep -v '@' | grep -E 'No migrations|✅|rror' || true
out=$(npm run -s deploy 2>&1 | grep -v '@') || { echo "$out" | tail -20 >&2; exit 1; }
version=$(echo "$out" | sed -n 's/.*Current Version ID: \([0-9a-f]*\).*/\1/p')
session=$(curl -fsS "$LIVE/api/session")
echo "deployed $(git rev-parse --short HEAD) as version ${version:0:8}"
echo "live /api/session: $session"
