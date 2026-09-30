import type { ReactNode } from 'react';
import type { NavBarProps } from '../ui';

// A page or a side panel: the editor or list says what its head holds, the caller how it looks.
export type Frame = (parts: { head: NavBarProps; body: ReactNode }) => ReactNode;
