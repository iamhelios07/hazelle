import type { ModelSettings } from '../connectors/settings';
import type { Mark } from './library';

// A 설정 묶음: one set of model settings, used by every starred model that names it.
export type Profile = Mark & { name: string; settings: ModelSettings };
