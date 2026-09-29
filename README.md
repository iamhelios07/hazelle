# risu-alpha

A lightweight character chat app, written from scratch as an alternative to [RisuAI](https://github.com/kwaroran/RisuAI). It supports RisuAI's features and file formats but shares none of its code.

The main differences from RisuAI:

- Data is stored per chat and per character instead of in one save file, so opening a chat loads only that chat.
- Everything is encrypted in the browser before upload. The server stores ciphertext and cannot read chats or API keys.
- Provider connections, GitHub Copilot sign-in and balance checks are built in rather than added through plugins.

The project is in early alpha. It runs as a hosted web app used by its author, and signup closes after the first account. The UI is in Korean.

## Features

Chat
- Send, regenerate, continue and branch. Edits and regenerations are kept as versions instead of overwriting earlier replies.
- A per-reply info panel showing the request that was sent, the lorebook entries that fired, token counts, cache hits and cost.
- Per-chat notes and toggles, switching persona, prompt or model mid-chat, and per-device reading settings (font, size, spacing).
- Keyboard shortcuts.

Characters
- Drop a file anywhere to import it. A summary lists what came in and what was left out.
- Folders, a gallery view, a character editor, and a trash for deleted characters.

Prompts and models
- A block-based prompt editor. RisuAI presets (`.risup`) import as prompts.
- Personas.
- Per-model setting profiles and prompt caching settings.
- Auxiliary model slots, reserved for upcoming features such as long-term memory and translation.

Connections
- Anthropic, OpenRouter, Vercel AI Gateway, and GitHub Copilot (through GitHub sign-in).
- Any OpenAI-compatible or Anthropic-compatible endpoint.
- Remaining balance and limits per connection, and cost per reply. Values a provider doesn't report are shown as unknown.

Backup
- A full backup exports the whole account as one zip, which can be restored into a new, empty account.

Not built yet: status panels, long-term memory, replies that keep streaming after the tab closes, assets other than avatars, usage gauges, and translation. Out of scope: group chat, image generation, TTS, plugins, card v1, embeddings, and trigger scripts and Lua (may be revisited).

## Security model

One password both signs in and unlocks the vault. The browser derives two independent values from it: a login proof, which is all the server receives, and the key that decrypts the data, which never leaves the browser. Prompt assembly, CBS, lorebooks and regex run in the browser for the same reason.

A recovery key is downloaded at signup. It is the only way back in if the password is lost. If both are lost, nobody can recover the data, including the operator. A full backup is a separate safety net.

Model requests go through a relay on the server, which forwards the request and streams the response back without storing or logging bodies or keys.

What the server can still see:
- Metadata: the kinds, counts, sizes and timestamps of stored items.
- Prompts in transit through the relay. Not logging them is a rule in the code, not a cryptographic guarantee.
- Which accounts hold the same asset file. Asset files are encrypted with a key derived from their content so that identical files are stored once across accounts. Their contents stay private.

## RisuAI import

Supported: character cards v2/v3 (PNG, charx, JSON), `.risum` modules (including the one inside a charx), lorebooks, regex scripts, CBS, and `.risup` presets. CBS tags that depend on features this app doesn't have (assets, buttons, triggers, modules) are dropped.

Triggers, Lua, assets, `backgroundHTML`, embeddings and encrypted cards are not imported. The import summary shows how many were skipped.

RisuAI's bugs and quirks are deliberately not reproduced, even where existing bots rely on them.

## Development

Requires Node 22.12 or later.

```sh
npm install
npm run db:migrate:local   # apply the schema to the local D1
npm run dev                # Vite with a local Worker, D1 and R2
```

Local development needs no secrets or `.dev.vars`.

| Command | What it runs |
|---|---|
| `npm run check` | Type checks, ESLint, stylelint and Vitest |
| `npm test` | Vitest only |
| `npm run e2e` | A build, then Playwright against a fresh local D1 and R2 |

Before changing code, read [`docs/tech-spec.md`](docs/tech-spec.md) §3 for the folder layout and import rules, which `eslint/boundaries.js` enforces, and [`src/app/ui/README.md`](src/app/ui/README.md) for the styling rules: design values live only in `tokens.css`, and only `src/app/ui` styles elements.

### Deploying

Runs on Cloudflare Workers (paid plan), D1 and R2.

1. Create a D1 database and an R2 bucket, and set `database_id` and `bucket_name` in `wrangler.jsonc`.
2. `npm run db:migrate:remote`
3. `npm run deploy`

Signup closes once the first account exists.

## Docs

- [`docs/design.md`](docs/design.md): what the app does and why, including core flows, the connector contract and RisuAI compatibility.
- [`docs/tech-spec.md`](docs/tech-spec.md): how it's built, including hosting, the vault, sync, the relay and known risks.
- [`docs/research/`](docs/research/): notes on RisuAI's behavior, the plugin workarounds this app replaces, and long-term memory research.

## License

[AGPL-3.0-only](LICENSE)

No RisuAI code (GPL-3.0) is used. Compatibility is implemented from a behavioral spec, [`docs/research/risu-compat-spec.md`](docs/research/risu-compat-spec.md). The project is AGPL because reading `.risum` files and RisuAI-exported charx files requires RPack, which is licensed AGPL-3.0 to everyone except RisuAI itself.
