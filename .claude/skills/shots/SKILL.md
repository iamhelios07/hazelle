---
name: shots
description: Take screenshots of risu-alpha screens after UI work and send them to the user. Use after any user-visible change, or whenever a screen must be seen, instead of the e2e harness.
---

# Screenshots

The dev server keeps an account, so a script signs in within about 1 s. No build and no signup are needed.

1. Write `shots/<topic>.spec.ts`. The `shots/` folder is gitignored and scripts are throwaway.

   ```ts
   import { test } from '@playwright/test';
   import { enterShots, SIZES, snap } from '../e2e/shots';

   test('topic', async ({ page }) => {
     await page.setViewportSize(SIZES.wide);
     await enterShots(page);
     // navigate and open what changed, by role and name, as e2e/flow.spec.ts does
     await snap(page, '1-wide');
   });
   ```

2. Run `./node_modules/.bin/playwright test -c playwright.shots.config.ts shots/<topic>.spec.ts`. It starts vite on port 5180, or reuses one already running.
3. Look at every image with Read before sending. Then send them with SendUserFile (load it with ToolSearch `select:SendUserFile`), in the order a user would click, with a one-line caption.

Facts that cost reruns before:
- Set the viewport before opening a menu or panel. Crossing 960px remounts the page and closes the panel. `SIZES` has wide (panel beside the page), medium (panel over the page) and phone.
- A reply needs a model. `fakeProvider(page)` from `e2e/helpers.ts` answers the relay with a fixed reply, but the account needs a connection first. See the connection step in `e2e/flow.spec.ts`.
- The account is `shots` / `shots-password`, holding the Mira card. If `.wrangler/state` was wiped, run `./node_modules/.bin/wrangler d1 migrations apply risu-alpha --local` once. The next `enterShots` then signs up and imports the card again.
- A failing locator waits for the whole timeout. When a run fails, read `test-results/*/error-context.md`: it lists the real accessible names.
