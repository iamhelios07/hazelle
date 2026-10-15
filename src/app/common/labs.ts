import { useSettings } from '../session';

// One id per entry of LABS: deleting an id breaks every reader of it at compile time.
export type LabId = never;
type Lab = { id: LabId; name: string; help: string };

// The experiments running, each a switch on 설정 › 실험실. An experiment ends by deleting its entry together with the
// path that lost (design.md, 실험실). It may add stored data the old path does not read, never change a stored shape
// (user ruling): turned off, its data stays hidden and comes back when turned on.
export const LABS: readonly Lab[] = [];

export const useLab = (id: LabId) => useSettings().labs?.includes(id) ?? false;
