---
name: tracks
description: Split multi-part risu-alpha work into parallel agent tracks in worktrees. Use when a request has two or more independent parts that touch different files, or a change big enough that one agent would take long.
---

# Parallel tracks

Parallel tracks save time only when the parts touch different files. For a small change, do it yourself.

1. Split by file ownership. Each track owns a set of files and does not edit the others' files. Shared pieces, such as a new type or a common helper, go in first, done by you on master, before the tracks start.
2. Start every track with the Agent tool, `isolation: "worktree"`, all in one message so they run at once. Each brief carries:
   - First command: `scripts/worktree.sh`. It fast-forwards to master (worktrees have been created at old commits) and links `node_modules`, so no install runs.
   - Run git as `/usr/bin/git`. The rtk hook rewrites a plain `git` to `rtk git`, and the worktree guard refuses that.
   - The files it owns, and the files it must not touch.
   - The comment rules and structure rules from CLAUDE.md, in full or by path.
   - Validation: `npm run check` and one focused test per changed behavior. No browser runs inside a track.
   - Commit on its branch with the repo's commit format. Do not push. Report the branch name.
3. When the tracks are done, merge each branch into master (`git merge --no-ff <branch>`) and fix conflicts.
4. Then run `npm run check` once, `npm run e2e` once if stored shapes or the core flow changed, and the shots skill for anything visible. Push, then remove the worktrees.
