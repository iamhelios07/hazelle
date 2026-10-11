# Data directory and durability

Everything the server keeps lives under one directory (`HAZELLE_DATA`, `/data` in the image), on a local POSIX filesystem:

```
lock.sqlite                      the process's exclusive lock (node.ts): a second process on the directory exits
service.sqlite                   accounts, sessions, vaults, service, installation, reports, admin_log, restores,
                                 account_files, file_blocks, notices, models_dev, models_dev_fetch, snapshots, migrations
accounts/<incarnation>.sqlite    one account's objects (head, objects, kv), WAL mode
files/<incarnation>/<sha256>     sealed pictures; .tmp-* while being written
streams.sqlite                   reply stream pages and their alarms (the alarm row is a stream's reservation); meta(version), a newer one is refused
snapshots/<incarnation>/<id>.sqlite.gz   point-in-time copies of an account file (baselines and operation checkpoints)
backup/<capturedAt>-<hex>/       one backup generation: service.sqlite.gz, snapshots/<incarnation>/<id>.sqlite.gz, manifest.json,
                                 and copied once the copier has sent it off-site
backup/files/<sha256>            the pictures every generation names, each once
```

Every SQLite file opens with `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, `foreign_keys=ON` (`openDatabase`). FULL
costs one fsync per commit and buys that an acknowledged commit survives power loss; the lifecycle orders a service write before an
account's deletion and relies on it.

A file is durable before any row says so. A picture: write `.tmp-<random>`, fsync it, rename, fsync the directory, then the service
commit that sets `stored = 1`. A snapshot: SQLite's asynchronous online backup makes a temp copy while the account queue holds its
writers; an archive worker compacts that private copy, runs `quick_check`, gzips it and fsyncs the gzip. The owner then renames it,
fsyncs the directory and writes the `snapshots` row. An account file at signup: schema and `head` written, checkpointed, fsynced, directory fsynced, then
the account's row. A directory made on the way is synced into its parent too (`makeDirs`, `durable.ts`). Deletion is the reverse: the service commit first, then the files. A crash between the two leaves a file with no row,
which the hourly reconciliation (`reconcile.ts`) removes once it is an hour old; it never leaves a row with no file.

Installing a snapshot over a live account file (an armed restore, `account-db.ts`): check the snapshot's size and SHA-256 against its
row, decompress beside the live file, `quick_check`, write `head.installed_from` and `head.installed_op` (the operation installing it, so
a second rewind to the same snapshot installs again), `wal_checkpoint(TRUNCATE)`, close, verify, fsync, delete the live file's `-wal` and `-shm`, rename over the live
file, fsync the directory. The WAL and shm go first so an orphan WAL is never replayed onto the installed file.

Snapshots (`src/server/backup/snapshots.ts`, run by the daily job at `HAZELLE_SNAPSHOT_HOUR` UTC): an account's current baseline is
its newest one not taken before its last finished rewind; a checkpoint never counts as one, nor does a baseline stamped after now (a
clock since put back). Every active account whose current baseline is from before today (UTC) or absent is selected; inside the
account's queue the take compares the file's `head.rev` with the `snapshots.rev` its current baseline recorded and, when they are
equal, copies nothing (`backup_runs.detail.unchanged`), since that baseline is still the account. An asked-for job (`backups.fresh`, SIGUSR2 before an
upgrade) selects every live account instead of those from before today, and a take that fails there fails its generation. A baseline is taken only of an
account that is active or restoring before its operation's checkpoint (begun, fenced), read from the service inside the account's
queue; any other is skipped.
A snapshot goes at 7 days (`RETENTION_MS`) unless pinned. An operation pins its checkpoint and target (an undo's from its begin) until it ends and
for 7 days after `restores.ended_at`, however it ended: a finished rewind's undo lives that long, and a cancelled or failed one stays
recoverable by hand. A live account keeps its floor, its newest baseline 7 days old or older, whatever its age: a time inside the
window may land on it. Pins are read from `restores`, so a deleted account
(whose restores cascade away) loses every snapshot at 7 days from its taking. A rewind lands on the newest snapshot at or before the
time asked, however old (the 6-day request window is the lifecycle's), never on one taken before the checkpoint of a rewind ended by then; the preview, the choice of a target (an undo's too)
and the install check the snapshot's size and SHA-256 against its row, and a mismatch answers unavailable before anything is armed.

Backup generations (`src/server/backup/generation.ts`), captured by the daily job after the baselines: while a gate keeps signup,
deletion and every rewind step out (ordinary writes go on), every active account with no current baseline gets one, as does one
restoring before its checkpoint whose current baseline is from before today unless its file is unchanged since, `Db.snapshot` makes an online copy of the service, and what that copy names is hard-linked (copied across filesystems) into
the generation: each account's newest baseline, every pinned snapshot, every picture whose `account_files` row says `stored = 1`
into the pool. Across filesystems the copy goes to a `.tmp-*` name, is synced and renamed, so a name in the pool is always whole. The gate's length is `backup_runs.gate_ms`. The archive worker then compacts, checks and gzips the service copy, and `manifest.json` is written last (temp,
fsync, rename, directory fsync); it lists every artifact with its SHA-256 (a picture's id is its SHA-256) and a database's size gzipped and gunzipped, each account's stored picture bytes, the migrations applied,
the account schema version, and every operation not done or not yet seen ending. A directory without a manifest is cut off and goes
after a day; a generation goes at 7 days, then every pooled picture no remaining manifest names.

The copier's contract: after a successful `rclone copy` of `backup/<id>/` (and the pool), it writes `backup/<id>/copied` holding one
line, the UTC ISO-8601 time of the copy. A generation is complete when it has both `manifest.json` and `copied`; backup freshness is
measured from the newest complete one. A restore verifies every hash the manifest names and refuses a generation that lacks one.

Freshness (`src/server/backup/freshness.ts`): `backupAgeHours` counts from the newest complete generation's capture (null when there
is none), `diskFreePercent` is the lowest of the data directory and `files/`. Above 36 hours without one (counted from the
installation's creation while there is none) or below 20 % free, the admin screen shows a banner and `HAZELLE_ALERT_WEBHOOK` gets a
Discord/Slack-style `{ content, text }` POST, as it does for a failed run of the day; each condition at most once a UTC day
(`alerts_sent`, written only after the POST succeeded). Every run of the job and every generation is a `backup_runs` row.

Disaster restore (`scripts/restore.sh <generation> <empty data dir>`, `src/server/backup/restore.ts`, bundled as
`dist/server/restore-cli.js`): verifies every hash first, writes the service (migrated to this build) before the pictures, drops
catalog rows for snapshots the generation lacks, restores each account from its newest baseline (a fenced one from its checkpoint,
one past `rewound` by installing its target), then ends every pending operation through `lifecycle.ts` (before `armed` cancelled,
from `armed` on finished, unverified ones finalized), finishes pending deletions, and gives every account a fresh timeline. The
server must not start on the directory until it has finished.

Service-table changes ship as a new `migrations/NNNN_*.sql`, applied by `migrate.ts` in one transaction each with a checksum ledger row.
The account file carries `head.schema_version`; a newer one than this build knows is refused, never downgraded.
