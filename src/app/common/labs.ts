import { useSettings } from '../session';

// One id per entry of LABS: deleting an id breaks every reader of it at compile time.
export type LabId = never;
type Lab = { id: LabId; name: string; help: string };

// The experiments running, each a switch on 설정 › 계정. An experiment never changes a stored shape, so turning it off
// leaves clean data; it ends by deleting its entry together with the path that lost (design.md, 실험실).
export const LABS: readonly Lab[] = [];

export const useLab = (id: LabId) => useSettings().labs?.includes(id) ?? false;
