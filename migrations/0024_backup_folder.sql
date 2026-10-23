-- A self-host's backup folder (server/backup/folder.ts): where each backup generation is copied, an absolute path of the
-- owner's machine. NULL: none set, so the backups stay on the data directory's disk.
ALTER TABLE service ADD COLUMN backup_folder TEXT;
