import type { PulseAnswer } from '../contracts/pulse';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, type Settings } from '../model/settings';
import { api } from './api';
import type { ObjectStore } from './store';

// 헤이젤 지금 (design §6.12): the account's switch, on unless set off.
export const sharesPulse = (settings: Settings | undefined) => settings?.pulse !== false;

export const setPulseSharing = (store: ObjectStore, on: boolean) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (on ? without(current, 'pulse') : { ...current, pulse: false }));

// The public board, signed in or not.
export const readPulse = (signal?: AbortSignal) => api<PulseAnswer>('GET', 'pulse', undefined, signal);
