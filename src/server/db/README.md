# Data directory and durability

Everything the server keeps lives under one directory (`HAZELLE_DATA`, `/data` in the image), on a local POSIX filesystem:

```
lock.sqlite                      the process's exclusive lock (node.ts): a second process on the directory exits
service.sqlite                   accounts, sessions, vaults, service, installation, reports, admin_log, restores,
                                 account_files, file_blocks, notices, prices, price_fetch, snapshots, migrations
accounts/<incarnation>.sqlite    one account's objects (head, objects, kv), WAL mode
files/<incarnation>/<sha256>     sealed pictures; .tmp-* while being written
snapshots/<incarnation>/<id>.sqlite.gz   point-in-time copies of an account file (baselines and operation checkpoints)
```

Every SQLite file opens with `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, `foreign_keys=ON` (`openDatabase`). FULL
costs one fsync per commit and buys that an acknowledged commit survives power loss; the lifecycle orders a service write before an
account's deletion and relies on it.

A file is durable before any row says so. A picture: write `.tmp-<random>`, fsync it, rename, fsync the directory, then the service
commit that sets `stored = 1`. A snapshot: `VACUUM INTO` a temp copy, `quick_check`, gzip to a second temp file, fsync, rename, fsync the
directory, then the `snapshots` row. An account file at signup: schema and `head` written, checkpointed, fsynced, directory fsynced, then
the account's row. Deletion is the reverse: the service commit first, then the files. A crash between the two leaves a file with no row,
which the hourly reconciliation (`reconcile.ts`) removes once it is an hour old; it never leaves a row with no file.

Installing a snapshot over a live account file (an armed restore, `account-db.ts`): decompress beside the live file, `quick_check`, write
`head.installed_from`, `wal_checkpoint(TRUNCATE)`, close, verify, fsync, delete the live file's `-wal` and `-shm`, rename over the live
file, fsync the directory. The WAL and shm go first so an orphan WAL is never replayed onto the installed file.

Snapshots (`src/server/backup/snapshots.ts`, run by the daily job at `HAZELLE_SNAPSHOT_HOUR` UTC): every active account whose newest
baseline is from before today (UTC), absent, or older than its last finished rewind gets a baseline; a checkpoint never counts as one.
A snapshot goes at 30 days unless pinned. An operation pins its checkpoint and target until it ends, and a finished rewind keeps both
for 30 days more, while its undo lives; a live account keeps its newest baseline whatever its age. Pins are read from `restores`, so a
deleted account (whose restores cascade away) loses every snapshot at 30 days from its taking. A rewind lands on the newest snapshot
at or before the time asked, never on one taken before the checkpoint of a rewind finished by then.

Service-table changes ship as a new `migrations/NNNN_*.sql`, applied by `migrate.ts` in one transaction each with a checksum ledger row.
The account file carries `head.schema_version`; a newer one than this build knows is refused, never downgraded.
