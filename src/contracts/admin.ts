export const MAX_REPORT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 2000;

export type BackupWarning = 'backup-stale' | 'disk-full';
// restoring: held by a restore until it ends. leaving: its deletion stopped before the end; removing it again finishes it.
export type AccountState = 'active' | 'restoring' | 'leaving';

// A restore rewinds an account's stored objects to a time; an undo rewinds them to just before a restore. Each runs only
// on a report that account sent. The phases run in order; from armed on, a restore can only go forward.
export type RestorePhase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export type RestoreAction = 'resume' | 'cancel' | 'finalize';

// A provider call the server admitted, by route: generate is a /streams start without a bot (replies, translations,
// memory), bot one a bot's script asked for, short a /relay call. short includes the app's own background calls (model
// lists, meters, sign-ins), so it is not what the person asked for. refused is a call the rate limits answered 429.
export type CallKind = 'generate' | 'bot' | 'short' | 'refused';
