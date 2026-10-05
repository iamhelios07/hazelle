# Hazelle

A character chat app, written from scratch as an alternative to [RisuAI](https://github.com/kwaroran/RisuAI). It reads RisuAI's file formats and runs its bots, but shares none of its code.

What sets it apart:

- Data is stored per chat and per character instead of in one save file, so opening a chat loads only that chat.
- Everything is encrypted in the browser before upload. The server stores ciphertext and cannot read chats or API keys.
- One server, one Docker image. Run it on your own machine, or use the hosted instance at [hazelle.app](https://hazelle.app).
- Replies keep streaming on the server after the tab closes; reopening the chat resumes them.

The project is in alpha. The UI is in Korean.

## Features

Chat
- Send, regenerate, continue and branch. Edits and regenerations are kept as versions instead of overwriting earlier replies.
- A per-reply panel showing the request that was sent, the lorebook entries that fired, token counts, cache hits and cost.
- Per-chat notes and switches, switching persona, prompt or model mid-chat, and per-device reading settings.
- Translation per character: replies shown in one language and the user's messages sent in another, while the model always reads the original. Each message can switch between original and translation, and both can be edited.
- Long-term memory with a token-based window, search inside a chat, bookmarks, up to five extra characters in one chat.
- Bot HTML and CSS, status panels, and bot scripts (Lua and block triggers) run in a sandboxed worker.

Characters
- Drop a file anywhere to import it. A summary lists what came in and what was left out.
- Folders, a gallery view, a character editor, modules, and a trash for deleted characters.

Prompts and models
- A block-based prompt editor. RisuAI presets (`.risup`) import as prompts.
- Personas, per-model setting profiles, prompt caching settings, and auxiliary model slots for translation, memory and other tasks.

Connections
- OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Moonshot, Upstage, Groq, Together, Cerebras, DeepInfra, Perplexity, NanoGPT, Chutes, Featherless, Friendli, Surplus, Ollama, and GitHub Copilot through GitHub sign-in.
- Any OpenAI-compatible or Anthropic-compatible endpoint, including local model servers on a self-hosted machine.
- Remaining balance and limits per connection, and cost per reply. Values a provider doesn't report are shown as unknown.

Moving from RisuAI
- Drop a RisuAI full backup together with its partial backup. Characters, chats, lorebooks, regex scripts, modules, presets and pictures come over; a summary lists what did not.

Backup
- A full backup exports the whole account as one zip, which can be restored into a new, empty account.
- The server takes a daily snapshot of every account and writes a backup generation that an rclone sidecar can copy off-site; the operator can rewind an account to a time in the last week.

Out of scope: group chat, image generation, TTS, RisuAI plugin compatibility, card v1, embeddings.

## Security model

One password both signs in and unlocks the vault. The browser derives two independent values from it: a login proof, which is all the server receives, and the key that decrypts the data, which never leaves the browser. Prompt assembly, CBS, lorebooks, regex and bot scripts run in the browser for the same reason.

A recovery key is downloaded at signup. It is the only way back in if the password is lost. If both are lost, nobody can recover the data, including the operator. A full backup is a separate safety net.

Model requests go through a relay on the server, which forwards the request and streams the response back without storing or logging bodies or keys. The streamed reply is sealed for the device that started it, so a reply kept on the server while the tab is closed is as unreadable to the server as stored data.

What the server can still see:
- Metadata: the kinds, counts, sizes and timestamps of stored items.
- Prompts in transit through the relay. Not logging them is a rule in the code, not a cryptographic guarantee.
- Which accounts hold the same picture. Pictures are encrypted with a key derived from their content so that identical files are stored once across accounts. Their contents stay private.

## RisuAI compatibility

Supported: character cards v2/v3 (PNG, charx, JSON), `.risum` modules (including the one inside a charx), lorebooks, regex scripts, CBS, `.risup` presets, bot HTML/CSS, Lua and block triggers.

Not imported: embeddings and encrypted cards. The import summary shows what was skipped.

RisuAI's bugs and quirks are deliberately not reproduced, even where existing bots rely on them.

## Self-hosting

Hazelle runs as one container with its data in one Docker volume. You need Docker with Compose v2.24 or newer.

### Start

Get `docker-compose.yml` and `deploy/rclone-backup.sh` from this repository or from the source archive attached to a release (keep the `deploy/` folder beside the compose file), then:

```sh
docker compose up -d
```

Open http://localhost:8080. The app listens on 127.0.0.1 only. The image is `ghcr.io/jiniill/hazelle`; `latest` is the newest release.

The first account created on a fresh installation is the operator. The operator account cannot be deleted while it is the only operator.

### Phones and other devices

Login and the encrypted vault need a secure context: the page must be served over HTTPS, or from `http://localhost` on the same machine. Opening `http://192.168.x.x:8080` from a phone can never work, whatever the settings. To reach Hazelle from another device, put HTTPS in front of port 8080, for example a Cloudflare tunnel with your own domain, or Tailscale Serve on your tailnet.

### Local models

The compose file allows three local model servers on the host machine: Ollama (11434), LM Studio (1234) and koboldcpp (5001). In Hazelle, enter the endpoint as `http://host.docker.internal:11434/v1` (or `:1234`, `:5001`), not `localhost`: inside the container, `localhost` is the container. The model server must listen beyond loopback: Ollama binds 127.0.0.1 unless started with `OLLAMA_HOST=0.0.0.0`; LM Studio has a "serve on local network" switch. Only the listed host:port pairs may be reached over plain http or at a private address; to add another, edit `HAZELLE_LOCAL_PROVIDERS` in `docker-compose.yml` (comma-separated `host:port`; a malformed entry stops the app from starting).

### Backups

Every day after 03:00 UTC the app takes a snapshot of each account and writes a backup generation under `backup/` in its volume. To keep copies elsewhere, run the `backup` profile, which copies every complete generation to any rclone remote (S3, Backblaze, Google Drive, a second disk) with `rclone copy` (never `sync`), keeps 7 days there, and marks each generation `copied` so the app knows it is safe:

1. Create the remote's settings beside the compose file: `mkdir -p rclone && rclone config --config ./rclone/rclone.conf` (the copier reads `/config/rclone/rclone.conf`). The copier runs as uid 1000: `chown -R 1000 rclone && chmod 700 rclone && chmod 600 rclone/rclone.conf`. Remotes that refresh OAuth tokens (Google Drive, Dropbox) rewrite the file, which needs the directory to be writable by that uid as well.
2. Put the remote and path in `.env` beside the compose file, e.g. `HAZELLE_BACKUP_REMOTE=mydrive:hazelle-backup`.
3. `docker compose --profile backup up -d`

The copier checks every hour. `docker compose --profile backup exec backup /bin/sh /hazelle/rclone-backup.sh once` runs one pass now.

### Alerts

`/api/health` reports `backupAgeHours` (since the newest generation that was copied off-site) and `diskFreePercent`. The admin screen shows a banner when no copied generation is newer than 36 hours, or the disk is less than 20 % free. Set `HAZELLE_ALERT_WEBHOOK` in `.env` to a Discord- or Slack-compatible webhook URL to get the same warnings, plus a failed daily backup job, at most once a day each.

### Restore

A restore fills a new, empty volume and leaves the current one alone; you switch to the new one only after it worked. Copy the generation folder and the `files/` folder beside it from your remote into one directory (e.g. `/path/to/backup/<generation>` and `/path/to/backup/files`), then:

```sh
docker compose --profile backup down
HAZELLE_VOLUME=hazelle_restored docker compose run --rm --no-deps -v /path/to/backup:/restore:ro --entrypoint /app/scripts/restore.sh app /restore/<generation> /data
```

The restore checks every file's hash and refuses an incomplete generation; if it fails, nothing was changed and `docker compose up -d` starts the old data again (remove the half-filled volume with `docker volume rm hazelle_restored` before another try). When it succeeds, add `HAZELLE_VOLUME=hazelle_restored` to `.env` beside the compose file and start:

```sh
docker compose up -d
```

Sign in and look. The old volume (`hazelle_data` unless you renamed it) stays on disk until you remove it yourself. Devices that were signed in are told to download their data again.

### Update

```sh
docker compose pull
docker compose up -d
```

`pull` only downloads; `up -d` replaces the container. A stop lets requests and replies in flight finish for up to 60 seconds. An image never opens data written by a newer version; to go back, restore the generation taken before the update.

## Development

Requires Node 24.

```sh
npm install
npm run dev   # the server (data in .data/) and Vite together; Ctrl-C stops both
```

Local development needs no secrets.

| Command | What it runs |
|---|---|
| `npm run check` | Type checks, ESLint, stylelint and Vitest |
| `npm test` | Vitest only |
| `npm run e2e` | A build, then Playwright against the built server on a fresh data directory |
| `npm run build` | The client, the server bundle and the source archive |

Styling rules are in [`src/app/ui/README.md`](src/app/ui/README.md): design values live only in `tokens.css`, and only `src/app/ui` styles elements. `eslint/boundaries.js` lists which layer may import which. The server's storage layout is in [`src/server/db/README.md`](src/server/db/README.md).

### Releases and the hosted instance

A `v*` tag builds the image for amd64 and arm64, pushes it to GHCR, and attaches the source archive and the image digest to the GitHub release. The hosted instance is one machine described in [`infra/`](infra/README.md) and updated with `scripts/deploy.sh <tag>`.

Design and technical documents are kept in a separate repository until launch.

## License

[AGPL-3.0-only](LICENSE)

No RisuAI code (GPL-3.0) is used. Compatibility is implemented from a behavioral specification written by observing RisuAI. The project is AGPL because reading `.risum` files and RisuAI-exported charx files requires RPack, which is licensed AGPL-3.0 to everyone except RisuAI itself. A running instance serves its own source at `/source.tar.gz`, linked from the legal notice.
