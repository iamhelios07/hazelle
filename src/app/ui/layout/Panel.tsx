import type { ReactNode } from 'react';
import type { Help } from '../overlays/Hint';
import { Section } from './Section';

type Props = {
  title: string;
  level?: 2 | 3;
  note?: string;
  help?: Help;
  // By the title: a button (sm) or a control that acts on the whole group, such as its Switch.
  action?: ReactNode;
  seek?: boolean;
  children: ReactNode;
};

export function Panel({ title, level = 2, note, help, action, seek = false, children }: Props) {
  return (
    <Section title={title} level={level} note={note} help={help} action={action} seek={seek} group>
      {children}
    </Section>
  );
}
