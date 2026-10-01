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
- The spacing, type and radius scales are short on purpose: pick the step whose role fits, never add a step between
  two for one component. A size several components share, such as a dot or a control's height, takes a size token.

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
| foundation | `Divider` | `Divider.module.css` | Lines between groups: the story's labeled line, with an icon and an action where a branch split, and the menu, tools and rail lines |
| foundation | `Icon` | `Icon.module.css` | Icon sizes and stroke |
| foundation | `Kbd` | `Kbd.module.css` | One key cap |
| foundation | `Tag` | `Tag.module.css` | A small label, such as a model's or a character's tag, or 기본 on the default |
| foundation | `Text` | `Text.module.css` | A paragraph by its role: body, a note (보조 설명: a status, a limit, a caption under a thing) or a highlighted line, such as the one marking a default; its alignment |
| layout | `ChatFrame` (`ChatTitle`, `Reading`, `readingDefault`) | `ChatFrame.module.css` | The chat page: header, story column, composer dock, the header and dock floating over the story (the header hides while it is read down, the dock keeps room for the whole composer); the chat's title, which opens the list of its chats; the reading settings, handed to the story's text and width as custom properties; slots for a `SidePeek` and a `StoryAside` over the story |
| layout | `Disclosure` | `Disclosure.module.css` | A line that opens what is folded under it, such as the settings a model does not take |
| layout | `EditorFrame` | `EditorFrame.module.css` | A long thing edited one part at a time: header, outline column, the open part |
| layout | `FaceRow` | `FaceRow.module.css` | A face beside the lines that go with it, centred on it as one block, such as the account's name |
| layout | `ListDetail` (`usePane`) | `ListDetail.module.css` | A list beside the item picked from it |
| layout | `NavBar` (`NavBarProps`) | `NavBar.module.css` | A screen's top row: back (an ×, a named link, or none), title (or a title that renames), a line under it, save state, actions; its props are the head an editor or list hands the frame it is shown in, a page or a side panel |
| layout | `Row` | `Row.module.css` | Items side by side, wrapping, spaced by kind: a toolbar, actions, tags, or a status before its buttons |
| layout | `Screen` | `Screen.module.css` | The page frame, as a page or as a pane; narrow, form or wide |
| layout | `Section` | `Section.module.css` | A titled group, at level 2 on a screen or 3 in a side panel, with an optional note, ⓘ explanation and action by its title |
| layout | `Shell` | `Shell.module.css` | The sidebar beside the page |
| layout | `SidePanel` | `SidePanel.module.css` | A panel beside the page, covering it where narrow, with an optional footer |
| layout | `Sidebar` (`Rail`, `FaceButton`, `FaceStrip`, `LayerSidebar`) | `Sidebar.module.css` | The sidebar, its rail, faces; a layer's own sidebar with its title and ×, which Esc closes too |
| layout | `Stack` | `Stack.module.css` | A column with a named gap: related, group or section |
| controls | `Button` | `Button.module.css` | Variants (a link and a delete among them), sizes, the busy spinner |
| controls | `Checkbox` | `Checkbox.module.css` | A labeled checkbox |
| controls | `ChipButton` | `ChipButton.module.css` | A rounded button naming a menu's current choice, shaped like a field for a setting, or borderless in the composer; with a leading icon or face |
| controls | `ChoiceGroup` | `ChoiceGroup.module.css` | Chips, equal buttons, a segmented strip, or a list with a line under each, for one choice |
| controls | `Composer` | `Composer.module.css` | The message box, with the chat's tools in its bar; `compact` folds it to one line until focus goes inside |
| controls | `EditBox` | `EditBox.module.css` | A message edited in place |
| controls | `FileButton` | — | A `Button` that opens a file picker |
| controls | `IconButton` | `IconButton.module.css` | Icon-only buttons and toggles, down to a message's tools; a letter in the icon's place, such as 가 |
| controls | `Link` | `Link.module.css` | A link to another site |
| controls | `MarkupArea` (`typeInto`, `markup.ts`) | `MarkupArea.module.css` | Prompt text with CBS tags, <tags>, headings and rules colored on a layer behind the textarea; an insert into it that Ctrl+Z takes back |
| controls | `NumberInput` | `NumberInput.module.css` | A number typed as text, with its unit: no spinner, no scroll-wheel changes |
| controls | `PhraseField` | `PhraseField.module.css` | Phrases as removable chips and a field that adds one on Enter, such as stop phrases |
| controls | `Pill` | `Pill.module.css` | A floating button over the story |
| controls | `SearchField` | `SearchField.module.css` | A search box |
| controls | `SendButton` | `SendButton.module.css` | Send, or stop a reply |
| controls | `SendNote` | `SendNote.module.css` | A few words beside `SendButton` about what sending now does (the prompt cache's time left); a `warning` adds its words, which phones leave to its icon, and its reason behind an ⓘ |
| controls | `Stepper` | `Stepper.module.css` | A whole number stepped one at a time between two bounds, such as the story's text size |
| controls | `Switch` | `Switch.module.css` | An on/off setting that takes effect at once, dimmed while it has no effect |
| controls | `TextField` | `TextField.module.css` | A labeled input or text area with its hint or error, and an ⓘ explanation by its label |
| controls | `TitleField` | `TitleField.module.css` | A title that is also the field that renames it |
| controls | `ToolButton` | `ToolButton.module.css` | A labeled tool around the story, such as 토글 and 노트, with a count or a dot |
| controls | `useAutosize.ts` (inside the kit only) | — | Grows `Composer`'s and `EditBox`'s text areas with their text |
| collections | `Breakdown` | `Breakdown.module.css` | A total split into parts |
| collections | `CardGrid` (`FaceCard`, `Portrait`, `SelectionBar`) | `CardGrid.module.css` | Characters as faces |
| collections | `Facts` | `Facts.module.css` | Label and value pairs |
| collections | `FolderRow` | `FolderRow.module.css` | A folder's row and the rows inside it, hung from its guide line |
| collections | `Item.tsx` (inside the kit only) | `Item.module.css` | Every row picked from a list, which `ItemRow`, `NavRow`, `FolderRow`, `ListItem`, `MenuItem` and `Tab` fill: its leading, title, meta, preview and trailing slots, four densities (chip, compact, regular, tall), the sidebar's, lists' and menus', and tabs' colours, and the hover and current fills (`--color-item-hover`, `--color-item-current`) |
| collections | `ItemRow` | `ItemRow.module.css` | A character or chat in the sidebar; 쓰는 중 |
| collections | `List` (`ListItem`) | `List.module.css` | A list's rows and the lines between them; a model id; a figure at a row's end; a control beside a row and rows set in under it |
| collections | `NavGroup` | `NavGroup.module.css` | A set of places in the app, spaced apart from the next set, such as 설정's |
| collections | `NavRow` | — | A place in the app, at the sidebar's foot or in a layer's sidebar; a part of a prompt above its outline, with what it holds at its end |
| collections | `Outline` | `Outline.module.css` | A prompt's blocks as a subway map: stops by kind, the line colored by section, add, remove, drag and key reordering |
| collections | `SettingGroup` (`SettingRow`) | `SettingGroup.module.css` | Settings in one box: each a name, its ⓘ explanation and a line of facts beside its control, which goes under them on phones; a row alone in a side panel's list, marked when it differs from its default |
| collections | `SideTitle` | `SideTitle.module.css` | The character whose chats the sidebar lists |
| collections | `Tabs` (`Tab`) | `Tabs.module.css` | Filters over one list |
| collections | `Tiles` (`Tile`) | `Tiles.module.css` | A few items to pick again, two to a row |
| overlays | `layers.ts` (`useLayer`, `useFocusTrap`) | — | The layer stack for Esc and presses outside; a dialog's focus trap |
| overlays | `ConfirmDialog` | — | A `Dialog` asking before something that cannot be undone |
| overlays | `Dialog` (`Shortcuts`) | `Dialog.module.css` | A small window over the page and its actions; the 단축키 list |
| overlays | `DropOverlay` | `DropOverlay.module.css` | The drop target while files are dragged in |
| overlays | `useFileDrop.ts` | — | Whether files are being dragged over the window, and the files dropped; a screen's own drop over the app's |
| overlays | `Hint` | `Hint.module.css` | An ⓘ that shows an explanation: after a moment's hover while the pointer stays, or pinned by a click or tap |
| overlays | `Menu` (`MenuItem`, `MenuHeading`, `useMenuHandle`, `useMenuOpener`, `useMenuClose`) | `Menu.module.css` | Menus opened from a button, each keeping its own open state; a handle shares it with other buttons that open the menu; a checked item's mark; a small form opened the same way (kind dialog), and a menu opened inside it |
| overlays | `Toast` | `Toast.module.css` | A notice on a light card: plain (message, detail, one action with its keys) or error (a warn band, why, where to fix it). Its action's time runs down as a line |
| overlays | `ToastStack` | `ToastStack.module.css` | Notices, newest in front, bottom right (under the header on a phone); pointing at it opens it and holds their time. Above every layer but the file drop |
| feedback | `ActionCard` | `ActionCard.module.css` | A large choice with a description |
| feedback | `Callout` | `Callout.module.css` | A warning or success note, with an optional action under it |
| feedback | `CodeBlock` | `CodeBlock.module.css` | Text as a program sent it, such as a request's address and body in 요청 원문; in body letters, what a prompt example gives |
| feedback | `CodeCard` | `CodeCard.module.css` | A code to copy, such as the recovery key |
| feedback | `Empty` | `Empty.module.css` | What stands where a list, grid, pane or panel has nothing to show, in the look of where it stands: a body, a section, the story, the pane beside a list, the sidebar or a menu |
| feedback | `Intro` | `Intro.module.css` | A screen's large title and lead |
| feedback | `Outcome` | `Outcome.module.css` | What an import brought and did not, a line each with why under it |
| feedback | `Steps` | `Steps.module.css` | Progress through steps |
| story | `Story` | `Story.module.css`, `Story.shadow.css` | Story text from the engine's HTML, in a shadow root: narration, dialogue, actions, a bot's own HTML and CSS sanitized and kept inside the message, its buttons dimmed; the streaming caret; faded while another text will take its place |
| story | `StoryMessage` (`Waiting`, `Switcher`, `Marker`, `Failure`) | `StoryMessage.module.css` | One message of the story, its quiet tag by the name (such as 번역, which flips it), its tools bar and markers |
| layout | `SidePeek` | `SidePeek.module.css` | A tab at the story's right edge, clear of its scrollbar, whose drawer slides over the story once the pointer rests on the tab, or held open (a key, a tap) with its own close, such as 상태; ChatFrame's `peek` slot places it |
| layout | `StoryAside` | `StoryAside.module.css` | A column in the story's right margin, over the page, its tools faint until pointed at, laid out even while not shown; ChatFrame's `aside` slot places it |
| story | `StatusBox` | `StatusBox.module.css` | A box of a bot's status window (상태창 지정) away from its message, as wide as the story's text: its script's name and actions among several |
| story | `MarginBox` | `MarginBox.module.css` | A bot's box in `StoryAside`: laid out at the story's text width, drawn smaller to fit the margin by what it visibly draws, whole over the story while pointed at; tells whether it fits at half its size or more |

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
