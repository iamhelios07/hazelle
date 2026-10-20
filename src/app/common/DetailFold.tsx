import type { ReactNode } from 'react';
import { Disclosure, SettingGroup } from '../ui';
import { DETAIL, detailLabel } from './words';

// The fold stays a quiet line (a ruling), never a row or a box's head. set: how many of its rows are set.
export function DetailFold({ set, children }: { set: number; children: ReactNode }) {
  return (
    <Disclosure label={detailLabel(set)}>
      <SettingGroup label={DETAIL}>{children}</SettingGroup>
    </Disclosure>
  );
}
