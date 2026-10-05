---
name: deploy
description: Deploy risu-alpha to the hosted machine (배포). Use when the user says 배포, deploy, or 올려 줘, after the work is committed and pushed.
---

# Deploy

These steps apply after the cutover (`docs/research/docker-port-plan.md` §16). Until then hazelle.app is the Cloudflare Worker, deployed from master with master's own script and skill.

Deploying is an external action. Run it only on the user's go-ahead for this batch.

1. Commit and push first. Then tag the release and push the tag: `/usr/bin/git tag vX.Y.Z`, `/usr/bin/git push origin vX.Y.Z`.
2. The tag runs `.github/workflows/release.yml`: `npm run check`, the source archive of the tag's commit, the image for amd64 and arm64 on GHCR, and a release whose notes carry the image digest. Wait for it with `gh run watch`.
3. Run `scripts/deploy.sh vX.Y.Z`. It needs a clean tree, `gh` logged in, docker, the Terraform state in `infra/` (for the machine's address) and ssh as root to the machine. It:
   - checks that the release's source archive and the one inside the image are the tag's commit;
   - stops if the machine already runs that digest;
   - asks the running app for a backup generation (SIGUSR2), waits up to 10 min for it, has the copier send it off-site and checks its copied marker; without one it changes nothing;
   - writes the digest into `HAZELLE_IMAGE` in `/etc/hazelle/env`, pulls and restarts the app, which drains first (up to 60 s; a reply still being written after that is cut);
   - waits up to 3 min for `/api/health`, then checks that the running container is the selected digest.
   It prints the previous image and the pre-upgrade generation id. Keep both in the report.
4. If health never answers or the new image misbehaves, the recovery is in the script's header: restore the pre-upgrade generation and start the previous digest. Writes since that generation are lost. Do it only with the user.
5. Report the tag in the user's terms: what they can now use.
6. If the change reshaped stored data, tell the user what their account will show differently.
7. Update the memory note for the batch with the deployed tag and digest.
