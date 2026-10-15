import type { ReactNode } from 'react';
import type { Help } from '../overlays/Hint';
import { Section } from './Section';

type Props = {
  title: string;
  level?: 2 | 3;
  help?: Help;
  // By the title: a button (sm) or a control that acts on the whole group, such as its Switch.
  action?: ReactNode;
  seek?: boolean;
  children: ReactNode;
};

// A group of a settings page. It draws no box: rows of controls take a SettingGroup, a list takes List's box, and
// what is only read (figures, gauges) stands open under the heading.
export function Panel({ title, level = 2, help, action, seek = false, children }: Props) {
  return (
    <Section title={title} level={level} help={help} action={action} seek={seek} group>
      {children}
    </Section>
  );
}
