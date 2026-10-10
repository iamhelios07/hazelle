import type { ReactNode } from 'react';
import { EditorFrame, NavBar, Screen, type NavBarProps } from '../ui';

// The editor or list says what its head holds, the caller how it looks. side: the parts beside the open one, in a split
// layout only. open: the part open, which a frame scrolls back to the top of when it changes.
export type Frame = (parts: { head: NavBarProps; body: ReactNode; side?: ReactNode; open?: string }) => ReactNode;

export const framePage: Frame = ({ head, body, side, open }) =>
  side === undefined ? (
    <Screen width="form" top={<NavBar {...head} />}>{body}</Screen>
  ) : (
    <EditorFrame top={<NavBar {...head} />} side={side} page={open}>
      {body}
    </EditorFrame>
  );
