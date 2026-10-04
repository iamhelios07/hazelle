---
name: deploy
description: Deploy risu-alpha to the live Worker (배포). Use when the user says 배포, deploy, or 올려 줘, after the work is committed and pushed.
---

# Deploy

Deploying is an external action. Run it only on the user's go-ahead for this batch.

1. Commit and push first. The script refuses a dirty tree or a HEAD that differs from `origin/master`.
2. Run `scripts/deploy.sh`. It runs `npm run check`, then waits until no provider call is live (a deploy cuts every reply being written): it prints the count every 20 s and goes on at 0, after 10 min, or after two failed counts in a row. `DEPLOY_NOW=1 scripts/deploy.sh` skips the wait; use it only when the user asks. Then it applies remote D1 migrations, deploys, and prints the short commit, the version id and the live `/api/session`. It drops output lines that contain an email.
3. If a D1 call fails with `7403 … not authorized`, run the script once more before suspecting the login.
4. Report the version id (first 8 characters) in the user's terms: what they can now use.
5. If the change renamed or reshaped stored data, tell the user what their account will show differently. There are no migrations for old data.
6. Update the memory note for the batch with the deployed version.
