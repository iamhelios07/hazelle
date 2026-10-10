# UI components

The rule that keeps a style change to one edit: **raw design values live in `foundation/tokens.css`,
and only this folder styles elements.**

- `foundation/tokens.css` holds every color, font, size, spacing, radius, border width, duration and
  layer (z-index). The palette layer is raw values from the approved mockups; the semantic layer
  (`--color-text-muted`, `--space-16`, `--layer-dialog`, …) is what components use.
- Themes: `:root` in `tokens.css` is dark and `:root[data-theme='light']` gives every palette-backed
  color token a light value; `foundation/theme.ts` (`applyTheme`) sets the attribute. A module never
  reads `--palette-*`; a surface that needs the other theme's colors (the toast) reads tokens
  defined per theme.
- `foundation/global.css` loads tokens and sets element defaults. `main.tsx` imports it once, then loads
  `foundation/fonts.css` after paint; slow or unavailable webfonts leave the system faces usable. The tool
  stylesheet imports both directly because its document has no application bootstrap.
- `foundation/media.ts` lists every media query in `MEDIA` and reads them in JavaScript (`useWide`,
  `useSplit`, `useHover`). A stylesheet cannot read it, so it writes the query out in full, and
  `media.test.ts` fails on any `@media` that `MEDIA` does not list.
- `foundation/motion.module.css` holds every keyframe, `foundation/a11y.module.css` the
  screen-reader-only box and the one-line ellipsis, and `type.module.css` and `surface.module.css` the looks several
  components share (a note, a box of rows, a field). Components take them with `composes` and never redeclare them.
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

## Patterns

One kind of thing looks and reads one way on every screen. The kit decides what it can; the rest is held here and in
`common/acts.ts` (one word and one icon per act, lint refuses the icons elsewhere) and `common/words.ts`.

- **Button sizes belong to their slot.** A `NavBar`'s actions and a `Section`'s action are `sm`, a `Dialog`'s actions
  and footer `md` (`ButtonSlot`); a caller in a slot passes no `size`. Free-standing buttons keep theirs.
- **A screen's head:** `{noun} 가져오기` (secondary, `ACTS.import`) before `새 {noun}` (secondary, `ACTS.create`);
  nothing primary. What is done to the thing the screen shows (사본 만들기, 기본으로 정하기, 삭제 in `tone="warn"`)
  goes in `NavBar` `menu`, a ⋯, never at the foot of the body. A row opened in place (a lorebook entry, a script)
  keeps `이 {noun} 삭제` (danger) at its own foot, and a row's own ⋯ is `MoreMenu`.
- **Words:** 새 X makes a thing of its own, X 추가 adds an entry to its owner's list. Files come in with 가져오기 and go out
  with 내보내기; 불러오는 중 means loading only. A failure offers 다시 시도. Reset is 기본값으로 되돌리기 in the
  section's action, a `link`. Stopping is 멈추기.
- **Rename:** an item named only by its name renames in `NavBar` `rename`; one with more identity (a character, a
  persona: name and alias) keeps its 이름 field. A row renames from its ⋯ (`ACTS.rename`).
- **Lists:** a list of places (`List places`) shows a › on each row; a list of the user's own things shows none.
  Contents go in `description`, where it is used in `aside`; an unused thing says nothing there. Counts read
  `{label} N개`, joined by ` · `. The default is the `badge` 기본.
- **Search** comes from `common/useSearch`: the field shows from `SEARCH_FROM` items and stays while words are typed;
  it stands first in the body's toolbar `Row`, sort and filters beside it. Its no-results `Empty` takes the variant
  of the list's own empty state.
- **Nothing here** is `Empty`, a sentence: `{noun}이 없어요.` An empty list of one's own things offers its first step as `Empty action` (the head's own 새 X or X 가져오기). A failure to load is `Callout tone="warn"` with
  다시 시도. Loading is a note ending in `…`.
- **Controls:** on/off is a `Switch`; one of up to four short choices is a segmented `ChoiceGroup`, more is a `Menu`
  behind a `ChipButton`; chips are for filters. Explanations go behind ⓘ (`help`), never as visible prose.
- **Width:** item editors and settings pages are `form`; a one-step flow (a key, a sign-in) is `narrow`.

## Components

| Folder | Component (other exports) | Stylesheet | What it styles |
| --- | --- | --- | --- |
| foundation | — | `tokens.css`, `global.css` | Every raw value; element defaults, a bare button among them, and reduced motion |
| foundation | — | `motion.module.css` | Every animation: fade, rise, drop, fade away, spin, pulse, blink, waiting dots |
| foundation | — | `a11y.module.css` | Screen-reader-only labels; one-line ellipsis |
| foundation | — | `type.module.css` | Shared text looks: a note, an error line, a field's label |
| foundation | — | `surface.module.css` | Shared surfaces: a box of rows and the line between them, a field and its compact size, an accent dot |
| foundation | `media.ts` (`MEDIA`, `useWide`, `useSplit`, `useHover`) | — | Every breakpoint and media query |
| foundation | `keys.ts` (`Chord`, `pressed`, `pressedKey`, `isComposing`, `keyCaps`, `formatKeys`) | — | Matching a key press, the IME guard, and keys written as text |
| foundation | `Avatar` | `Avatar.module.css` | A face: picture, first letter or icon, three sizes |
| foundation | `Brand` | `Brand.module.css` | The wordmark |
| foundation | `Divider` | `Divider.module.css` | Lines between groups: the story's labeled line, with an icon and an action where a branch split, and the menu, tools and rail lines |
| foundation | `Icon` | `Icon.module.css` | Icon sizes and stroke |
| foundation | `Kbd` | `Kbd.module.css` | One key cap |
| foundation | `Tag` | `Tag.module.css` | A small label, such as a model's or a character's tag, or 기본 on the default |
| foundation | `Text` | `Text.module.css` | A paragraph by its role: body, a note (보조 설명: a status, a limit, a caption under a thing) or prose; its alignment |
| layout | `ChatFrame` (`ChatTitle`, `Reading`, `readingDefault`, `useMarginRoom`) | `ChatFrame.module.css` | The chat page: header, story column, composer dock, the header and dock floating over the story (the header hides while it is read down, the dock keeps room for the whole composer); the chat's title, which opens the list of its chats; the reading settings, handed to the story's text and width as custom properties; a slot for a `SidePeek` over the story; with `stage`, the story set left with a stage on its right for 삽화 where that stage holds half its text's width (`useMarginRoom`) |
| layout | `Disclosure` | `Disclosure.module.css` | A line that opens what is folded under it, such as the settings a model does not take or a lorebook entry; what is folded is made only while open, and it can start open |
| layout | `EditorFrame` | `EditorFrame.module.css` | A long thing edited one part at a time: header, outline column, the open part |
| layout | `FaceRow` | `FaceRow.module.css` | A face beside the lines that go with it, centred on it as one block, such as the account's name |
| layout | `ListDetail` (`usePane`) | `ListDetail.module.css` | A list beside the item picked from it |
| layout | `NavBar` (`NavBarProps`) | `NavBar.module.css` | A screen's top row: back (an ×, a named link, or none), title (or a title that renames), a line under it, save state, actions, a ⋯ menu; its props are the head an editor or list hands the frame it is shown in, a page or a side panel |
| layout | `Row` | `Row.module.css` | Items side by side, wrapping, spaced by kind: a toolbar, actions, tags, or a status before its buttons |
| layout | `Screen` | `Screen.module.css` | The page frame, as a page or as a pane; narrow, form or wide. Its title, section titles and the words in its boxes share one left line: `SettingGroup` and `List` hang out by `--box-hang` |
| layout | `Section` | `Section.module.css` | A titled group, at level 2 on a screen or 3 in a side panel, with an optional note, ⓘ explanation and action by its title |
| layout | `Shell` | `Shell.module.css` | The sidebar beside the page |
| layout | `SidePanel` | `SidePanel.module.css` | A panel beside the page, covering it where narrow, with an optional footer |
| layout | `Sidebar` (`Rail`, `FaceButton`, `LayerSidebar`) | `Sidebar.module.css` | The sidebar, the rail of faces beside it; a layer's own sidebar with its title and ×, which Esc closes too |
| layout | `Stack` | `Stack.module.css` | A column with a named gap: related, group or section |
| layout | `ToolFrame` | `ToolFrame.module.css` | An opaque-origin tool page that fills the rest of its column (a `fill` Screen or SidePanel); the caller connects its window |
| layout | `TranslateDesk` | `TranslateDesk.module.css` | 번역기: a bar of choices, then the source and its translation side by side in one box (stacked on a narrow page), each pane with a foot of counts and buttons |
| controls | `Button` (`ButtonSlot`, inside the kit only) | `Button.module.css` | Variants (a link and a delete among them), sizes, the busy spinner; the size a slot decides |
| controls | `Checkbox` | `Checkbox.module.css` | A labeled checkbox, with a note after its label; dimmed when it cannot be ticked |
| controls | `ChipButton` | `ChipButton.module.css` | A rounded button naming a menu's current choice, shaped like a field for a setting, or borderless in the composer; with a leading icon or face |
| controls | `ChoiceGroup` | `ChoiceGroup.module.css` | Chips, equal buttons, a segmented strip, or a list with a line under each, for one choice; a shown label sits beside it in a toolbar, and above chips as a field's does |
| controls | `Composer` | `Composer.module.css` | The message box, with the chat's tools in its bar; `compact` folds it to one line until focus goes inside |
| controls | `EditBox` | `EditBox.module.css` | A message edited in place |
| controls | `FileButton` | — | A `Button` that opens a file picker |
| controls | `IconButton` | `IconButton.module.css` | Icon-only buttons and toggles, down to a message's tools; a letter in the icon's place, such as 가; a dot when something behind it needs a look |
| controls | `Link` | `Link.module.css` | A link to another site |
| controls | `MarkupArea` (`typeInto`, `markup.ts`) | `MarkupArea.module.css` | Prompt text with CBS tags, <tags>, headings and rules colored on a layer behind the textarea; an insert into it that Ctrl+Z takes back |
| controls | `NumberInput` | `NumberInput.module.css` | A number typed as text, with its unit: no spinner, no scroll-wheel changes |
| controls | `PhraseField` | `PhraseField.module.css` | Phrases as removable chips and a field that adds one on Enter, such as stop phrases |
| controls | `Pill` | `Pill.module.css` | A floating button over the story |
| controls | `SearchField` | `SearchField.module.css` | A search box; one that fills a row, such as the chat header's search bar, with its count and buttons at its end |
| controls | `SendButton` | `SendButton.module.css` | Send, or stop a reply |
| controls | `SendNote` | `SendNote.module.css` | A few words beside `SendButton` about what sending now does (the prompt cache's time left); a `warning` adds its words, which phones leave to its icon, and its reason behind an ⓘ |
| controls | `Stepper` | `Stepper.module.css` | A whole number stepped one at a time between two bounds, such as the story's text size |
| controls | `Switch` | `Switch.module.css` | An on/off setting that takes effect at once, dimmed while it has no effect |
| controls | `TextField` | `TextField.module.css` | A labeled input or text area with its hint or error, and an ⓘ explanation by its label; read-only on a quieter ground; text taken as typed (a key, an address, a script's code) in the mono face |
| controls | `TitleField` | `TitleField.module.css` | A title that is also the field that renames it |
| controls | `ToolButton` | `ToolButton.module.css` | A labeled tool around the story, such as 토글 and 노트, with a count or a dot |
| controls | `useAutosize.ts` (inside the kit only) | — | Grows `Composer`'s and `EditBox`'s text areas with their text |
| collections | `Viewport` (`ROWS_RESIZED`) | `Viewport.module.css` | A keyed, measured window within its scroll parent or document, a `ul` of `li` rows when named as a list; keeps focused rows, reading choices, keyboard traversal and source/current jumps across remounts, holds what is being read while rows above it are measured, and says when a row's height changed |
| collections | `Breakdown` | `Breakdown.module.css` | A total split into parts |
| collections | `CardGrid` (`FaceCard`, `Portrait`, `SelectionBar`) | `CardGrid.module.css` | Characters as faces |
| collections | `Facts` | `Facts.module.css` | Label and value pairs |
| collections | `FolderRow` (`TreeRow`) | `FolderRow.module.css` | A folder's row and the rows inside it, hung from its guide line |
| collections | `Item.tsx` (inside the kit only) | `Item.module.css` | Every row picked from a list, which `ItemRow`, `NavRow`, `FolderRow`, `ListItem`, `MenuItem` and `Tab` fill: its leading, title, meta, preview and trailing slots, four densities (chip, compact, regular, tall), the sidebar's, lists' and menus', and tabs' colours, and the hover and current fills (`--color-item-hover`, `--color-item-current`) |
| collections | `ItemRow` | `ItemRow.module.css` | A character or chat in the sidebar; 쓰는 중 |
| collections | `List` (`ListItem`) | `List.module.css` | A list's rows and the lines between them, in a box or not, a › on each row of a list of places, or, given keys, only the rows near the view; a model id; a figure at a row's end; a control beside a row, something under a row's text such as a gauge, and rows set in under it |
| collections | `NavGroup` | `NavGroup.module.css` | A set of places in the app, spaced apart from the next set, such as 설정's |
| collections | `NavRow` | — | A place in the app, at the sidebar's foot or in a layer's sidebar; a part of a prompt above its outline, with what it holds at its end |
| collections | `Outline` | `Outline.module.css` | A prompt's blocks as a subway map: stops by kind, the line colored by section, add, remove, drag and key reordering |
| collections | `SettingGroup` (`SettingRow`) | `SettingGroup.module.css` | Settings in one box: each a name, its ⓘ explanation and a line of facts beside its control, which goes under them on phones; a row alone in a side panel's list, marked when it differs from its default |
| collections | `SideTitle` | `SideTitle.module.css` | The character whose chats the sidebar lists |
| collections | `Tabs` (`Tab`) | `Tabs.module.css` | Filters over one list |
| overlays | `layers.ts` (`useLayer`, `useFocusTrap`) | — | The layer stack for Esc and presses outside; a dialog's focus trap |
| overlays | `ConfirmDialog` | — | A `Dialog` asking before something that cannot be undone |
| overlays | `Dialog` (`Shortcuts`) | `Dialog.module.css` | A small window over the page and its actions; the 단축키 list |
| overlays | `DropOverlay` | `DropOverlay.module.css` | The drop target while files are dragged in |
| overlays | `useFileDrop.ts` | — | Whether files are being dragged over the window, and the files dropped; a screen's own drop over the app's |
| overlays | `MoreMenu` | — | The ⋯ that opens what is done to a thing as a whole, in a screen's head (`NavBar` `menu`) or a row, named '{of} 메뉴' |
| overlays | `Hint` | `Hint.module.css` | An ⓘ that shows an explanation: after a moment's hover while the pointer stays, or pinned by a click or tap |
| overlays | `Menu` (`MenuItem`, `MenuHeading`, `useMenuHandle`, `useMenuOpener`, `useMenuClose`) | `Menu.module.css` | Menus opened from a button, each keeping its own open state; a handle shares it with other buttons that open the menu; a checked item's mark, as one choice of several or one of any number checked (`multiple`); a disabled item; a small form opened the same way (kind dialog), and a menu opened inside it |
| overlays | `Toast` | `Toast.module.css` | A notice on a light card: plain (message, detail, one action with its keys) or error (a warn band, why, where to fix it). Its action's time runs down as a line. Someone else's words, such as a bot's, under their face and name: line breaks kept, four lines until pressed, then whole with a × |
| overlays | `ToastStack` | `ToastStack.module.css` | Notices, newest in front, bottom right (under the header on a phone); pointing at it opens it and holds their time. Above every layer but the file drop |
| feedback | `ActionCard` | `ActionCard.module.css` | A large choice with a description |
| feedback | `AskCard` (`AskAnswer`) | `AskCard.module.css` | A question that waits beside what the user is doing, such as a bot's above the composer: who asks, the question with an ⓘ explanation, a line to type or a few choices, and a × that puts it away |
| feedback | `Callout` | `Callout.module.css` | A warning or success note, with an optional action under it |
| feedback | `CodeBlock` | `CodeBlock.module.css` | Text as a program sent it, such as a request's address and body in 요청 원문; in body letters, what a prompt example gives |
| feedback | `CodeCard` | `CodeCard.module.css` | A code to copy, such as the recovery key |
| feedback | `Empty` | `Empty.module.css` | What stands where a list, grid, pane or panel has nothing to show, in the look of where it stands: a body, a section, the story, the pane beside a list, the sidebar or a menu; the first step out of it under the sentence |
| feedback | `Gauge` | `Gauge.module.css` | How much of an allowance is used, with a mark where an even use would stand by now, a status word, a note and what is left; figures alone where there is nothing to measure against |
| feedback | `Intro` | `Intro.module.css` | A screen's large title and lead |
| feedback | `Outcome` | `Outcome.module.css` | What an import brought and did not, a line each with why under it |
| feedback | `Progress` | `Progress.module.css` | Work under way. Plain: a row per step with its label, bar and count; a step without a total shows its count over a flowing bar; two or more counted steps get a 전체 row. `hero`: the mark filling with the whole and the floored percent, then the steps as stages in order (a check once over, the one under way with its count and bar, a hollow ring still to come), with `title` under the percent and `note` under the stages; a label-only step marked `finished` is a stage done before the counted ones began. Used by the first load, the Risu move and the backup dialog |
| feedback | `Steps` | `Steps.module.css` | Where the user stands in a short flow of screens, such as signup |
| story | `Story` (`BotButton`, `inlaid`) | `Story.module.css`, `Story.shadow.css` | Story text from the engine's HTML, in a shadow root: narration, dialogue, actions, a bot's own HTML and CSS sanitized and kept inside the message, its buttons live or dimmed, and which one was pressed (`BotButton`); the streaming caret; faded while another text will take its place; the message's 삽화 slotted in where its mark stands, or at the end (`inlaid`) |
| story | `StoryPicture` | `StoryPicture.module.css` | A picture made for a message (삽화) in its story: its frame at the picture's shape while it loads or is made, the 이미지 가리기 stand-in, and a foot of controls |
| story | `StoryMessage` (`Waiting`, `Switcher`, `Marker`, `Failure`) | `StoryMessage.module.css` | One message of the story, its quiet tag by the name (such as 번역, which flips it), the badges tools put on it (two, then +N), its foot, a row under the message holding its markers (cut, stopped, translation, 삽화) on the left and its tools on the right, its height kept while the tools are absent; a ring that fades from a message looked for, such as a memory record's source, and the view taken to it |
| layout | `SidePeek` (`SidePeeks`) | `SidePeek.module.css` | A tab at the story's right edge, clear of its scrollbar, whose drawer (a card the size of its content at the story's middle) slides over the story once the pointer rests on the tab, or held open (a key, a tap) with its own close, such as 상태; `SidePeeks` holds it in ChatFrame's `peek` slot |
| story | `StatusBox` | `StatusBox.module.css` | A box of a bot's status window (상태창 지정) away from its message, as wide as the story's text: its script's name and actions among several |
| story | `MarginPicture` | `MarginPicture.module.css` | A message's 삽화 on the stage right of the story, level with the paragraph its anchor marks, following the reader to the message's end; a picture narrower than the text grows leftward over it to the text's width while pointed at |
| story | `LogExport` (`LogRow`, `snapshotPage`) | `LogExport.module.css` | A chat drawn once out of sight and handed back as HTML whose look rides in style attributes only (`snapshot.ts`), for a page pasted on another site: the shadow roots read through, every picture whole, and the bot rules a style attribute cannot carry counted; `snapshotPage` wraps it as a file |

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
