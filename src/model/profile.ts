import type { ModelSettings } from '../connectors/settings';
import type { Mark } from './library';

export type Profile = Mark & { name: string; settings: ModelSettings };
