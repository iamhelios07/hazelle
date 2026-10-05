---
name: tracks
description: Split multi-part risu-alpha work into parallel agent tracks in worktrees. Use when a request has two or more independent parts that touch different files, or a change big enough that one agent would take long.
---

# Parallel tracks

Parallel tracks save time only when the parts touch different files. For a small change, do it yourself.

The base branch is the one the main checkout is on (`port` until the Docker cutover, then `master`).

1. Split by file ownership. Each track owns a set of files and does not edit the others' files. Shared pieces, such as a new type or a common helper, go in first, done by you on the base branch, before the tracks start.
2. Start every track with the Agent tool, `isolation: "worktree"`, all in one message so they run at once. Each brief carries:
   - First command: `scripts/worktree.sh`. Worktrees are cut from wherever the tool chooses, often an old master; it resets the fresh worktree to the base branch (or the branch given as its argument), refusing if the worktree already has commits or changes of its own, and links `node_modules`, so no install runs. Then `/usr/bin/git log --oneline -1` must show the base branch's head.
   - Run git as `/usr/bin/git`. The rtk hook rewrites a plain `git` to `rtk git`, and the worktree guard refuses that.
   - The files it owns, and the files it must not touch.
   - The comment rules and structure rules from CLAUDE.md, in full or by path.
   - Validation: the steps of `npm run check` with four test workers, and one focused test per changed behavior. No browser runs inside a track.
   - Commit on its branch with the repo's commit format. Do not push. Report the branch name.
3. When the tracks are done, merge each branch into the base branch (`git merge --no-ff <branch>`) and fix conflicts.
4. Then run `npm run check` once, `npm run e2e` once if stored shapes or the core flow changed, and the shots skill for anything visible. Push, then remove the worktrees.
