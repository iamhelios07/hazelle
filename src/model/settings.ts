import type { Assignment } from '../connectors/assignment';

// One settings object per account, at a fixed id, so two devices that create it at once meet in a
// version conflict instead of making two.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';

// The 전체 기본값 layer of the model assignment (design §4.1).
export type Settings = { models: Assignment };
