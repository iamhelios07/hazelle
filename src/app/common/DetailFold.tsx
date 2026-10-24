import type { ReactNode } from 'react';
import { Disclosure, Section, SettingGroup, Stack } from '../ui';
import { DETAIL, detailLabel } from './words';

type Rows = { children: ReactNode; sections?: never } | { sections: { title: string; rows: ReactNode }[]; children?: never };

// The fold stays a quiet line (a ruling), never a row or a box's head. set: how many of its rows are set. sections: its
// rows under titles, for a page whose detail spans several things.
export function DetailFold({ set, children, sections }: { set: number } & Rows) {
  return (
    <Disclosure label={detailLabel(set)}>
      {sections ? (
        <Stack gap="section">
          {sections.map(({ title, rows }) => (
            <Section key={title} level={3} title={title}>
              <SettingGroup label={title}>{rows}</SettingGroup>
            </Section>
          ))}
        </Stack>
      ) : (
        <SettingGroup label={DETAIL}>{children}</SettingGroup>
      )}
    </Disclosure>
  );
}
