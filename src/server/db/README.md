# Data directory and durability

Databases and staging files live under `HAZELLE_DATA` (`/data` in the image), on a local POSIX filesystem.
The file store chosen by `HAZELLE_FILES_BUCKET` owns pictures and snapshot archives, on disk at the paths below or in R2 under the same keys:

```
lock.sqlite                      the process's exclusive lock (node.ts): a second process on the directory exits
service.sqlite                   accounts, sessions, vaults, service, installation, reports, admin_log, restores,
                                 account_files, file_blocks, picture_removals, snapshot_removals, notices, models_dev, models_dev_fetch,
                                 snapshots, backup_runs, alerts_sent, shares, share_versions, share_files, migrations
accounts/<incarnation>.sqlite    one account's objects (head, objects, kv), WAL mode
files/<incarnation>/<sha256>     sealed pictures; .tmp-* while being written. With HAZELLE_FILES_BUCKET=r2 the same keys
                                 live in an R2 bucket instead (src/server/files/, infra/README.md "Pictures in R2")
cache/<sha256>                   with the R2 bucket, a copy of pictures read or put, by id alone; .tmp-* while being written.
                                 Never fsynced, captured or restored; trimmed hourly (src/server/files/cached-r2-bucket.ts)
streams.sqlite                   reply stream pages and their alarms (the alarm row is a stream's reservation); meta(version), a newer one is refused
snapshots/<incarnation>/<id>.sqlite.gz   point-in-time copies of an account file (baselines and operation checkpoints), whole files
                                 or deltas against one whole snapshot; in the file store, never the picture cache
backup/<capturedAt>-<hex>/       one backup generation: service.sqlite.gz, manifest.json, and (disk store only)
                                 snapshots/<incarnation>/<id>.sqlite.gz;
                                 copied once the copier has sent it off-site
backup/files/<sha256>            the pictures every disk generation names, each once
backup/departures.json           the accounts that left while a generation from before may still be restored
                                 (src/server/backup/departures.ts); rewritten whole, copied off-site on every copier pass
```

Every SQLite file opens with `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, `foreign_keys=ON` (`openDatabase`). FULL
costs one fsync per commit and buys that an acknowledged commit survives power loss; the lifecycle orders a service write before an
account's deletion and relies on it. `streams.sqlite` alone opens with `synchronous=NORMAL`: its page writes come from every live reply on
the event loop, and a power loss drops only its newest commits.

A file is durable before any row says so. A picture: write `.tmp-<random>`, fsync it, rename, fsync the directory, then the service
commit that sets `stored = 1`. A snapshot: SQLite's asynchronous online backup makes a temp copy (a whole snapshot), or the live handle
selects the whole `head` and `kv` and the `objects` above the base's rev into a temp file (a delta), while the account queue holds its
writers, then releases the baseline queue (and any handle opened just for it). Checkpoints keep the queue until publication. The capture fixes `taken_at` and `rev`; an archive worker compacts that private copy, runs `quick_check`, gzips it and fsyncs the gzip. The owner publishes it through `Bucket.putFile` and only then writes the `snapshots` row: disk copies to a temporary name, fsyncs, renames and syncs the directory; R2 streams a signed PUT with `UNSIGNED-PAYLOAD` and the file size as `Content-Length`. The private copy and gzip are staged under `accounts/.tmp-*` and removed afterwards. An account file at signup: schema and `head` written, checkpointed, fsynced, directory fsynced, then
the account's row. A directory made on the way is synced into its parent too (`makeDirs`, `durable.ts`). Deletion is the reverse: the service commit first, then the files. A crash between the two leaves a file with no row,
which the hourly reconciliation (`reconcile.ts`) removes once it is an hour old (a picture prefix in R2 is queued in
`picture_removals` and goes 7 days later). An uncatalogued R2 archive an hour old is queued in `snapshot_removals`, due when the newest local generation naming it expires, at once when none does; a catalogued archive cancels that queue entry. No read falls back to a previous disk location.

Installing a snapshot over a live account file (an armed restore, `account-db.ts`): `materializeSnapshot` checks the snapshot's size and
SHA-256 against its row (a delta's base too), decompresses the whole file beside the live file, applies a delta's rows onto it and checks
`head.rev` against the row; then `quick_check`, write `head.installed_from` and `head.installed_op` (the operation installing it, so
a second rewind to the same snapshot installs again), `wal_checkpoint(TRUNCATE)`, close, verify, fsync, delete the live file's `-wal` and `-shm`, rename over the live
file, fsync the directory. The WAL and shm go first so an orphan WAL is never replayed onto the installed file.

Snapshots (`src/server/backup/snapshots.ts`, run by the daily job at `HAZELLE_SNAPSHOT_HOUR` UTC): an account's current baseline is
its newest one on the account's current timeline (a row records the timeline at capture; one from before migration 0007 has none and never
counts); a checkpoint never counts as one, nor does a baseline stamped after now (a clock since put back). Every active account whose current baseline is from before today (UTC) or absent is selected; inside the
account's queue the take compares the file's `head.rev` with the `snapshots.rev` its current baseline recorded and, when they are
equal, copies nothing (`backup_runs.detail.unchanged`), since that baseline is still the account. An asked-for job (`backups.fresh`, SIGUSR2 before an
upgrade) selects every live account instead of those from before today, and a take that fails there fails its generation. A baseline is taken only of an
account that is active or restoring before its operation's checkpoint (begun, fenced), read from the service inside the account's
queue; any other is skipped.
A snapshot catalog entry goes at 7 days (`RETENTION_MS`) unless pinned. A delta is taken against the account's base, its newest whole snapshot
taken on the account's current timeline (a row records it; signup, a finished rewind and a disaster restore each start a new one) at the
current account schema version and younger than 6 days, a day short of expiry so a base chosen for a capture is not expired before
the capture's row names it (none: the snapshot taken is whole), never against another delta; a whole snapshot stays as long as a delta
names it. A capture that deletes a body its base holds is stored whole instead (the base and the delta materialized at the captured
rev), so a base never holds a body deleted after it and may live as long as its deltas; a capture deleting only rows written since its
base stays a delta. An operation pins its checkpoint and target (an undo's from its begin) until it ends and
for 7 days after `restores.ended_at`, however it ended: a finished rewind's undo lives that long, and a cancelled or failed one stays
recoverable by hand. A live account keeps its floor, its newest baseline 7 days old or older of any timeline, whatever its age: a time inside the
window may land on it, also one from before a rewind. Pins are read from `restores`, so a deleted account
(whose restores cascade away) loses every snapshot catalog entry at 7 days from its taking; R2 archive deletion is deferred as described below. A rewind lands on the newest snapshot at or before the
time asked, however old (the 6-day request window is the lifecycle's), never on one taken before the checkpoint of a rewind ended by then; the preview, the choice of a target (an undo's too)
and the install check the snapshot's size and SHA-256 against its row, and a mismatch answers unavailable before anything is armed.

Backup generations (`src/server/backup/generation.ts`), captured by the daily job after the baselines: while a gate keeps signup,
deletion, every rewind step, file-bearing writes, share publication and file sweeps out (other writes go on), every active
account with no current baseline gets one, as does one
restoring before its checkpoint whose current baseline is from before today unless its file is unchanged since, `Db.snapshot` makes an online copy of the service, and what that copy names is hard-linked (copied across filesystems) into
the generation with the disk store: each account's newest baseline, every pinned snapshot, the base of each and every picture whose
`account_files` row says `stored = 1`, plus released pictures that any named snapshot can still refer to, into the pool.
Capturing a generation extends those releases' deadlines through its retention. Restoring the generation verifies and
copies both sets and reclaims releases against each installed snapshot; recovery never promotes a pending upload
reservation to a stored copy. With the R2 store the manifest names both pictures and archives where they are;
the copier pools the archives in the backup bucket before marking a generation copied. A deleted account's pictures stay in R2 until
`picture_removals.due_at`, 7 days after deletion was queued. Snapshot catalog expiry atomically queues `snapshot_removals` (migration
0009), due when the newest local v4 generation naming the archive expires (`namedArchives`), at once when none does; the hourly sweep
also waits while any local v4 generation names the archive, including a generation whose expiry has not run successfully, so a
`--snapshots-from-store` restore of a kept generation finds every archive. Disk expiry deletes immediately because hard links keep generations independent.
The manifest (version 4) records picture `bucket` and `snapshotStore` (`{kind:"disk"}` or `{kind:"r2",bucket:<name>}`) for all its
snapshot entries. Versions 1–3 still read with archives in the generation; version 2 snapshots are all whole, version 3 may contain
deltas, and version 1 pictures are disk-pooled. Across filesystems the copy goes to a `.tmp-*` name, is synced and renamed, so a name in the pool is always whole. The gate's length is `backup_runs.gate_ms`. The archive worker then compacts, checks and gzips the service copy, and `manifest.json` is written last (temp,
fsync, rename, directory fsync); it lists every artifact with its SHA-256 (a picture's id is its SHA-256) and a database's size gzipped and gunzipped (a snapshot's also materialized: a delta's with its base's, which `scripts/destroy.sh` sizes a drill by), each account's stored picture bytes, the migrations applied,
the account schema version, and every operation not done or not yet seen ending. A directory without a manifest is cut off and goes
after a day; a generation goes at 7 days, and sooner once copied off-site unless it is one of the two newest or the newest of its UTC
day (every deploy captures one); then every pooled picture no remaining disk generation names. The remote (`deploy/rclone-backup.sh`) drops its own generations by the same rule, read from its listing alone.

The copier's contract: it copies disk-pooled pictures and, for v4 R2 generations, every named archive from the `files` rclone remote
to `<backup remote>/snapshots/<bucket>/<incarnation>/<id>.sqlite.gz`, then the generation, its manifest last, then `copied` on the remote
and locally holding the UTC ISO-8601 time. An archive pool entry goes only when no remote manifest names it and the source store lacks it. A generation is complete when it has both `manifest.json` and `copied`; backup freshness is
measured from the newest complete one. A restore verifies every hash the manifest names and refuses a generation that lacks one.

Freshness (`src/server/backup/freshness.ts`): `backupAgeHours` counts from the newest complete generation's capture (null when there
is none), `diskFreePercent` is the lowest of the data directory and `files/`. Above 36 hours without one (counted from the
installation's creation while there is none) or below 20 % free, the admin screen shows a banner and `HAZELLE_ALERT_WEBHOOK` gets a
Discord/Slack-style `{ content, text }` POST, as it does for a failed run of the day; each condition at most once a UTC day
(`src/server/alerts.ts`, which also sends server-slow; `alerts_sent`, written only after the POST succeeded). Every run of the job and every generation is a `backup_runs` row.

Disaster restore (`scripts/restore.sh <generation> <empty data dir>`, `src/server/backup/restore.ts`, bundled as
`dist/server/restore-cli.js`, into the file store `HAZELLE_FILES_BUCKET` names): verifies every hash first (an R2
generation's pictures by a HEAD of each, size only, and only into an R2 store; a pooled generation's are put into whichever
store is set). `scripts/restore.sh fetch <backup remote> <id> <download directory>` fetches v4 R2 archives from the backup pool into the
generation; it needs rclone and its config, as in the copier container. A local v4 R2 generation can instead be restored explicitly with
`--snapshots-from-store`; this streams from the recorded store and verifies the same hashes, with no fallback. Restore writes the service (migrated to this build) before the pictures, drops
catalog rows for snapshots the generation lacks, restores each account by materializing the snapshot the manifest names for it (its current baseline, or its operation's checkpoint once
past the fence, where no baseline is taken; one past `rewound` by installing its target over that), then ends every pending operation through `lifecycle.ts` (before `armed` cancelled,
from `armed` on finished, unverified ones finalized), finishes pending deletions, deletes again every account `departures.json` beside
the generation names (refusing before anything is written when that file is missing, unless given `--without-departures`), carries
that file into the new directory, revokes every session, gives every account a fresh timeline, and prints the accounts it restored. The
server must not start on the directory until it has finished.

Service-table changes ship as a new `migrations/NNNN_*.sql`, applied by `migrate.ts` in one transaction each with a checksum ledger row.
The account file carries `head.schema_version`; a newer one than this build knows is refused, never downgraded.
