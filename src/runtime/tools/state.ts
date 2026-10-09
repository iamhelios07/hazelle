import { UNSET } from '../../engine/script-api';
import type { Json } from '../../tool-api/manifest';

// UNSET is valid JSON null too. JSON whitespace distinguishes a saved null from deletion without boxing the value.
export const encodeState = (value: Json | undefined): string => value === undefined ? UNSET : ` ${JSON.stringify(value)}`;
export const decodeState = (value: string | undefined): Json | undefined => value === undefined || value === UNSET ? undefined : JSON.parse(value) as Json;
