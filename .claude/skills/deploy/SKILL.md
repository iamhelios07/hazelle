---
name: deploy
description: Deploy Hazelle to the hosted machine (배포). Use when the user says 배포, deploy, or 올려 줘, after the work is committed and pushed.
---

# Deploy

Deploying is an external action. Run it only on the user's go-ahead for this batch.

0. Commit and push first, then `scripts/release.sh vX.Y.Z` does steps 1–3 in one command: it tags HEAD, pushes the tag, captures the pre-upgrade backup (`scripts/deploy.sh --prepare`) while the build runs, waits for the build and runs `scripts/deploy.sh`, which uses that backup when it is under 15 minutes old and taken under the digest still running. Its output is deploy.sh's; the steps below are what it does, and the way to carry on by hand when it stops between them (the tag and build stay; run `scripts/deploy.sh vX.Y.Z`).
1. Tag the release and push the tag: `/usr/bin/git tag vX.Y.Z`, `/usr/bin/git push origin vX.Y.Z`.
2. The tag runs `.github/workflows/release.yml`: `npm run check` beside the source archive of the tag's commit and the image for amd64 and arm64 on GHCR, then, once both pass, a release whose notes carry the image digest. A tag whose check failed may have an image but no release, so it cannot be deployed. Wait for it with `gh run watch`.
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
