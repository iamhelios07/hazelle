import type { ReactNode } from 'react';
import type { NavBarProps } from '../ui';

// The editor or list says what its head holds, the caller how it looks.
export type Frame = (parts: { head: NavBarProps; body: ReactNode }) => ReactNode;
