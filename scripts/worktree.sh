#!/usr/bin/env bash
# Readies an agent's worktree: brings it to master and links the main checkout's node_modules, so no install runs.
# Run from inside the worktree. The link is enough for check, vitest, build and wrangler (tried 2026-09-30).
set -euo pipefail
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git merge -q --ff-only master
[ -e node_modules ] || ln -s "$main/node_modules" node_modules
echo "worktree at $(git rev-parse --short HEAD) (master $(git rev-parse --short master)), node_modules -> $main/node_modules"
