# UI components

The rule that keeps a style change to one edit: **raw design values live in `tokens.css`, and only
this folder styles elements.**

- `tokens.css` holds every color, size, font and duration. The palette layer is raw values from the
  approved mockups; the semantic layer (`--color-text-muted`, `--space-16`, …) is what components use.
- `global.css` loads fonts and tokens and sets element defaults. `main.tsx` imports it once.
- Each component is a `.tsx` with its own `.module.css`.

## Rules

- Components take variants (`variant`, `size`, `tone`, `kind`, `gap`), never `className` or `style`.
  A screen that needs a new look extends a component or adds one here.
- Screens (`src/app/screens/`) and the app shell compose these components. They import no CSS and
  pass no `className` or `style`.
- Only give a palette value a semantic name when its role is visible in an approved mockup.

## Enforced by `npm run check`

- stylelint: outside `tokens.css`, colors, fonts, spacing, radii and shadows must use `var(--…)`.
  Hex colors, named colors and `rgb()`/`hsl()` are refused.
- ESLint: no `className` or `style` props and no CSS imports outside this folder and `main.tsx`,
  and no hex color strings anywhere in `src/app`.
- `typed-css-modules` generates a type for each `.module.css`, so a misspelled class name fails
  the type check. The generated `*.module.d.css.ts` files are not committed.
