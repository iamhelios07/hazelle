import type { ModelSettings } from '../connectors/settings';

// A 설정 묶음: one set of model settings, used by every starred model that names it. deleted and purging: model/library Mark.
export type Profile = { name: string; settings: ModelSettings; deleted?: number; purging?: true };
