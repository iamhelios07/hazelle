import type { ModelSettings } from '../connectors/settings';

// A 설정 묶음 (design §4.4): one set of model settings, used by every starred model that names it.
export type Profile = { name: string; settings: ModelSettings };
