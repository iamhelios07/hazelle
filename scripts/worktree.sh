#!/usr/bin/env bash
# Readies an agent's fresh worktree: moves it to the base branch and links the main checkout's node_modules, so no
# install runs. Run from inside the worktree:
#   scripts/worktree.sh [base]
# base defaults to the branch the main checkout is on. Worktrees are cut from wherever the tool chooses (often master,
# at an old commit), so the worktree is reset to base; it refuses once the worktree has commits, changes or untracked
# files of its own (a hard reset overwrites an untracked file at a path the base tracks, with no copy to recover).
set -euo pipefail
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
base=${1:-$(git -C "$main" symbolic-ref --short HEAD)}
git rev-parse -q --verify "$base^{commit}" >/dev/null || { echo "worktree: no branch $base" >&2; exit 1; }
# Its own commits: reachable from HEAD and from no other branch, remote or tag. Where it was cut from does not count.
branch=$(git symbolic-ref -q --short HEAD || true)
own=$(git rev-list --count HEAD --not --exclude="${branch:-}" --branches --remotes --tags)
[ "$own" = 0 ] || { echo "worktree: HEAD has $own commit(s) of its own; not resetting" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo "worktree: uncommitted changes or untracked files; not resetting" >&2; exit 1; }
git reset -q --hard "$base"
[ -e node_modules ] || ln -s "$main/node_modules" node_modules
echo "worktree at $(git rev-parse --short HEAD) ($base), node_modules -> $main/node_modules"
