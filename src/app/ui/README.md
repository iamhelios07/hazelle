# UI components

The rule that keeps a style change to one edit: **raw design values live in `foundation/tokens.css`,
and only this folder styles elements.**

- `foundation/tokens.css` holds every color, font, size, spacing, radius, border width, duration and
  layer (z-index). The palette layer is raw values from the approved mockups; the semantic layer
  (`--color-text-muted`, `--space-16`, `--layer-dialog`, …) is what components use.
- `foundation/global.css` loads fonts and tokens and sets element defaults. `main.tsx` imports it once.
- `foundation/media.ts` lists every media query in `MEDIA` and reads them in JavaScript (`useWide`,
  `useSplit`, `useHover`). A stylesheet cannot read it, so it writes the query out in full, and
  `media.test.ts` fails on any `@media` that `MEDIA` does not list.
- `foundation/motion.module.css` holds every keyframe, and `foundation/a11y.module.css` the
  screen-reader-only box and the one-line ellipsis. Components take them with `composes`.
- `overlays/layers.ts` is the only document listener for keys and presses. Menus and dialogs join
  its stack with `useLayer`, and Esc or a press outside reaches the newest one only.
- Each component is a `.tsx` named after its main export, with its own `.module.css`, in one of the
  folders below. Each folder has an `index.ts`, and `index.ts` here re-exports them all. Inside the
  kit, files import each other by path, never through an index.

## Rules

- Components take variants (`variant`, `size`, `tone`, `kind`, `gap`), never `className` or `style`.
  A screen that needs a new look extends a component or adds one here.
- Screens (the feature folders beside this one) and the app shell compose these components, imported from `src/app/ui`. They
  import no CSS and pass no `className` or `style`.
- Only give a palette value a semantic name when its role is visible in an approved mockup.

## Components

| Folder | Component (other exports) | Stylesheet | What it styles |
| --- | --- | --- | --- |
| foundation | — | `tokens.css`, `global.css` | Every raw value; element defaults, a bare button among them, and reduced motion |
| foundation | — | `motion.module.css` | Every animation: fade, rise, drop, spin, pulse, blink, waiting dots |
| foundation | — | `a11y.module.css` | Screen-reader-only labels; one-line ellipsis |
| foundation | `media.ts` (`MEDIA`, `useWide`, `useSplit`, `useHover`) | — | Every breakpoint and media query |
| foundation | `keys.ts` (`Chord`, `pressed`, `pressedKey`, `isComposing`, `keyCaps`, `formatKeys`) | — | Matching a key press, the IME guard, and keys written as text |
| foundation | `Avatar` | `Avatar.module.css` | A face: picture, first letter or icon, three sizes |
| foundation | `Brand` | `Brand.module.css` | The wordmark |
| foundation | `Divider` | `Divider.module.css` | Lines between groups: the story's labeled line, and the menu, tools and rail lines |
| foundation | `Icon` | `Icon.module.css` | Icon sizes and stroke |
| foundation | `Kbd` | `Kbd.module.css` | One key cap |
| foundation | `Tag` | `Tag.module.css` | A small label, such as a model's or a character's tag; a gold one, such as 기본 |
| foundation | `Text` | `Text.module.css` | A paragraph's size, tone and alignment |
| layout | `ChatFrame` (`ChatTitle`) | `ChatFrame.module.css` | The chat page: header, story column, composer dock; the chat's title |
| layout | `EditorFrame` | `EditorFrame.module.css` | A long thing edited one part at a time: header, outline column, the open part |
| layout | `ListDetail` (`usePane`) | `ListDetail.module.css` | A list beside the item picked from it |
| layout | `NavBar` | `NavBar.module.css` | A screen's top row: back, title (or a title that renames), a line under it, save state, actions |
| layout | `Row` | `Row.module.css` | Items side by side, wrapping, spaced by kind: a toolbar, actions or tags |
| layout | `Screen` | `Screen.module.css` | The page frame, as a page or as a pane |
| layout | `Section` | `Section.module.css` | A titled group, at level 2 on a screen or 3 in a side panel, with an optional note and action by its title |
| layout | `Shell` | `Shell.module.css` | The sidebar beside the page |
| layout | `SidePanel` | `SidePanel.module.css` | A panel beside the page, covering it where narrow |
| layout | `Sidebar` (`Rail`, `FaceButton`, `FaceStrip`) | `Sidebar.module.css` | The sidebar, its rail, faces |
| layout | `Stack` | `Stack.module.css` | A column with a named gap: related, group or section |
| controls | `Button` | `Button.module.css` | Variants (a link among them), sizes, the busy spinner |
| controls | `Checkbox` | `Checkbox.module.css` | A labeled checkbox |
| controls | `ChipButton` | `ChipButton.module.css` | A rounded button naming a menu's current choice |
| controls | `ChoiceGroup` | `ChoiceGroup.module.css` | Chips, equal buttons, a segmented box or a list with a line under each, for one choice |
| controls | `Composer` | `Composer.module.css` | The message box |
| controls | `EditBox` | `EditBox.module.css` | A message edited in place |
| controls | `FileButton` | — | A `Button` that opens a file picker |
| controls | `IconButton` | `IconButton.module.css` | Icon-only buttons and toggles, down to a message's tools |
| controls | `Link` | `Link.module.css` | A link to another site |
| controls | `MarkupArea` (`markup.ts`) | `MarkupArea.module.css` | Prompt text with CBS tags, <tags>, headings and rules colored on a layer behind the textarea |
| controls | `Pill` | `Pill.module.css` | A floating button over the story |
| controls | `SearchField` | `SearchField.module.css` | A search box |
| controls | `SendButton` | `SendButton.module.css` | Send, or stop a reply |
| controls | `Switch` | `Switch.module.css` | An on/off setting that takes effect at once |
| controls | `TextField` | `TextField.module.css` | A labeled input or text area with its hint or error |
| controls | `TitleField` | `TitleField.module.css` | A title that is also the field that renames it |
| controls | `useAutosize.ts` (inside the kit only) | — | Grows `Composer`'s and `EditBox`'s text areas with their text |
| collections | `AccountRow` | `AccountRow.module.css` | Who is signed in |
| collections | `Breakdown` | `Breakdown.module.css` | A total split into parts |
| collections | `CardGrid` (`FaceCard`, `Portrait`, `SelectionBar`) | `CardGrid.module.css` | Characters as faces |
| collections | `Facts` | `Facts.module.css` | Label and value pairs |
| collections | `FolderRow` | `FolderRow.module.css` | A folder's row and the rows inside it, hung from its guide line |
| collections | `Item.tsx` (inside the kit only) | `Item.module.css` | Every row picked from a list, which `ItemRow`, `NavRow`, `FolderRow`, `ListItem`, `MenuItem` and `Tab` fill: its leading, title, meta, preview and trailing slots, four densities (chip, compact, regular, tall), the sidebar's, lists' and menus', and tabs' colours, and the hover and current fills (`--color-item-hover`, `--color-item-current`) |
| collections | `ItemRow` | `ItemRow.module.css` | A character or chat in the sidebar; 쓰는 중 |
| collections | `List` (`ListItem`) | `List.module.css` | A list's rows and the lines between them; a model id; a control beside a row and rows set in under it |
| collections | `NavRow` | — | A place in the app, at the sidebar's foot, with what it holds at its end |
| collections | `Outline` | `Outline.module.css` | A prompt's blocks as a subway map: stops by kind, the line colored by section, add, remove, drag and key reordering |
| collections | `SideTitle` | `SideTitle.module.css` | The character whose chats the sidebar lists |
| collections | `Tabs` (`Tab`) | `Tabs.module.css` | Filters over one list |
| collections | `Tiles` (`Tile`) | `Tiles.module.css` | A few items to pick again, two to a row |
| overlays | `layers.ts` (`useLayer`, `useFocusTrap`) | — | The layer stack for Esc and presses outside; a dialog's focus trap |
| overlays | `ConfirmDialog` | — | A `Dialog` asking before something that cannot be undone |
| overlays | `Dialog` (`Shortcuts`) | `Dialog.module.css` | A small window over the page and its actions; the 단축키 list |
| overlays | `DropOverlay` | `DropOverlay.module.css` | The drop target while files are dragged in |
| overlays | `useFileDrop.ts` | — | Whether files are being dragged over the window, and the files dropped; a screen's own drop over the app's |
| overlays | `Menu` (`MenuItem`, `MenuHeading`, `useMenuHandle`, `useMenuOpener`) | `Menu.module.css` | Menus opened from a button, each keeping its own open state; a handle shares it with other buttons that open the menu; a checked item's mark |
| overlays | `Toast` | `Toast.module.css` | A short notice, above every layer but the file drop |
| feedback | `ActionCard` | `ActionCard.module.css` | A large choice with a description |
| feedback | `Callout` | `Callout.module.css` | A warning or success note, with an optional action under it |
| feedback | `CodeCard` | `CodeCard.module.css` | A code to copy, such as the recovery key |
| feedback | `Empty` | `Empty.module.css` | What stands where a list, grid, pane or panel has nothing to show, in the look of where it stands: a body, a section, the story, the pane beside a list, the sidebar or a menu |
| feedback | `Intro` | `Intro.module.css` | A screen's large title and lead |
| feedback | `Outcome` | `Outcome.module.css` | What an import brought and did not, a line each with why under it |
| feedback | `Steps` | `Steps.module.css` | Progress through steps |
| story | `Prose` (`prose.ts`) | `Prose.module.css` | Story text: narration, dialogue, actions, the streaming caret |
| story | `StoryMessage` (`Waiting`, `Switcher`, `Marker`, `Failure`) | `StoryMessage.module.css` | One message of the story, its tools bar and markers |

## Enforced by `npm run check`

- stylelint: outside `tokens.css`, colors, fonts, spacing, radii, shadows, border widths, z-index,
  animation and transition timings, widths and heights must use `var(--…)`. A width or height may
  also be a percentage or `100dvh`. Hex colors, named colors and `rgb()`/`hsl()` are refused.
- Vitest: `foundation/media.test.ts` fails on a media query that `MEDIA` does not list.
- ESLint: no `className` or `style` props and no CSS imports outside this folder and `main.tsx`,
  and no hex color strings anywhere in `src/app`. Nothing here imports anything outside this folder
  (the `ui` area in `eslint/boundaries.js`).
- `typed-css-modules` generates a type for each `.module.css`, so a misspelled class name fails
  the type check. The generated `*.module.d.css.ts` files are not committed.
