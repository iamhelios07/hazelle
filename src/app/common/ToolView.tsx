import { useCallback, useRef } from 'react';
import { useDisplay } from '../display';
import { useSession } from '../session';
import { ToolFrame } from '../ui';

type Props = { module: string; chat: string | null; title: string; size: 'page' | 'panel'; onClose: () => void };

export function ToolView({ module, chat, title, size, onClose }: Props) {
  const { tools } = useSession();
  const { display: { theme } } = useDisplay();
  const close = useRef(onClose);
  close.current = onClose;
  // New chat chunks change callbacks, not the frame or the tool's unsaved page state.
  const mount = useCallback((window: Window) => tools.page(module, { window, chat, theme, close: () => close.current() }), [tools, module, chat, theme]);
  return <ToolFrame key={`${module}:${chat}:${theme}`} title={title} size={size} onMount={mount} />;
}
