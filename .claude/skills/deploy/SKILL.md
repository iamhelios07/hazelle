---
name: deploy
description: Deploy Hazelle to the hosted machine (배포). Use when the user says 배포, deploy, or 올려 줘, after the work is committed and pushed.
---

# Deploy

Deploying is an external action. Run it only on the user's go-ahead for this batch.

새 소식, before anything is tagged: run `scripts/release-notes.sh HEAD`. If anything in it is something a user would notice, draft an entry at the top of `NEWS` in `src/app/common/release.ts` (version the tag about to be made, date the deploy day, a few lines in the app's copy voice, not the commit subjects), show it to the user, and commit what they approve. A release of internal changes only gets no entry. If an entry for the coming tag was drafted ahead (one carrying a `tour`), amend its version, date and lines instead of adding a second. A release whose headline feature everyone should know of gets a `tour` (`common/Tour.tsx`): a title, three pages each naming a `TourArt` picture drawn in `common/tourArt.tsx`, and a `go` route; the newest tour shows once per device to everyone who opens the app, newcomers included, and 새 소식 replays it. The GitHub release's notes are the script's output and need nothing by hand.

Compose files first, when `docker-compose.yml` or `docker-compose.hosted.yml` changed since the running tag (`/usr/bin/git diff --stat <running tag> HEAD -- docker-compose.yml docker-compose.hosted.yml`): the machine got them from cloud-init once (`infra/main.tf`) and nothing copies them later. Copy both to `/etc/hazelle/` with scp and run a full `hazelle-compose up -d` there (never `up -d app` alone: a network change then moves the app and leaves Caddy behind, an outage), and only then deploy the image. The running image ignores a variable it does not know, so this step is safe on its own; the other order is not (the first such change, 2026-10-17: the `edge` network and `HAZELLE_TRUSTED_PROXIES`; an app without it sees every visitor as Caddy's address and they share one signup and login budget). Before the first `edge` rollout check that 172.30.0.0/24 is free: `docker network inspect $(docker network ls -q) -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'`.

0. Commit and push first, then `scripts/release.sh vX.Y.Z` does steps 1–3 in one command: it tags HEAD, pushes the tag, captures the pre-upgrade backup (`scripts/deploy.sh --prepare`) while the build runs, waits for the build and runs `scripts/deploy.sh`, which uses that backup when it is under 15 minutes old and taken under the digest still running. Its output is deploy.sh's; the steps below are what it does, and the way to carry on by hand when it stops between them (the tag and build stay; run `scripts/deploy.sh vX.Y.Z`).
1. Tag the release and push the tag: `/usr/bin/git tag vX.Y.Z`, `/usr/bin/git push origin vX.Y.Z`.
2. The tag runs `.github/workflows/release.yml`: `npm run check` beside the source archive of the tag's commit and the image for amd64 and arm64 on GHCR, then, once both pass, a release whose notes list the commits since the previous tag and carry the image digest. A tag whose check failed may have an image but no release, so it cannot be deployed. Wait for it with `gh run watch`.
3. Run `scripts/deploy.sh vX.Y.Z`. It needs a clean tree, `gh` logged in, docker, the Terraform state in `infra/` (for the machine's address) and ssh as root to the machine with no flags: `ssh root@<ip>` must sign in by itself, so the machine's key is named in `~/.ssh/config` (`Host <ip>`, `IdentityFile ~/.ssh/hazelle_vm`); without it the session ends with status 255 before the first line. It:
   - checks that the release's source archive and the one inside the image are the tag's commit;
   - from here on, in one ssh session, holds an flock on `/run/hazelle-deploy.lock` on the machine; a second deploy meanwhile exits 5 and changes nothing;
   - if that digest is already selected (a retry after exit 4 or a lost session), starts it if needed, checks health and stops;
   - pulls the image, then uses the generation `--prepare` left in `/run/hazelle-prepared` if it is under 15 min old, taken under the running digest and marked copied; otherwise asks the running app for a backup generation (SIGUSR2), waits up to 30 min for it, has the copier send it off-site and checks its copied marker; without one it exits 3 and changes nothing;
   - records the running digest and that generation in `/etc/hazelle/previous`, writes the new digest into `HAZELLE_IMAGE` in `/etc/hazelle/env` and restarts the app, which drains first (up to 60 s; a reply still being written after that is cut);
   - waits up to 5 min for `/api/health`, then checks that the running container is the selected digest; otherwise exit 4.
   It prints the previous image and the pre-upgrade generation id. Keep both in the report. A session that ends without an outcome: run it again (the script's header says why that is safe).
4. If health never answers or the new image misbehaves, the recovery is in the script's header: restore the pre-upgrade generation and start the previous digest. Writes since that generation are lost. Do it only with the user.
5. Report the tag in the user's terms: what they can now use.
6. If the change reshaped stored data, tell the user what their account will show differently.
7. Update the memory note for the batch with the deployed tag and digest.
