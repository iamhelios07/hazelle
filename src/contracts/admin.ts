export const MAX_REPORT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 2000;

export type BackupWarning = 'backup-stale' | 'disk-full';
// restoring: held by a restore until it ends. leaving: its deletion stopped before the end; removing it again finishes it.
export type AccountState = 'active' | 'restoring' | 'leaving';

// A restore rewinds an account's stored objects to a time; an undo rewinds them to just before a restore. Each runs only
// on a report that account sent. The phases run in order; from armed on, a restore can only go forward.
export type RestorePhase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export type RestoreAction = 'resume' | 'cancel' | 'finalize';
