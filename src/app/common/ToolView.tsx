import { useCallback, useRef } from 'react';
import { useDisplay } from '../display';
import { useSession } from '../session';
import { ToolFrame } from '../ui';

type Props = { module: string; chat: string | null; title: string; onClose: () => void };

export function ToolView({ module, chat, title, onClose }: Props) {
  const { tools } = useSession();
  const { display: { theme } } = useDisplay();
  const close = useRef(onClose);
  close.current = onClose;
  // New chat chunks change callbacks, never the frame. Another tool, chat or theme reloads it, unsaved page state and
  // all: the page reads its theme once, at its start.
  const mount = useCallback((window: Window) => tools.page(module, { window, chat, theme, close: () => close.current() }), [tools, module, chat, theme]);
  return <ToolFrame key={`${module}:${chat}:${theme}`} title={title} onMount={mount} />;
}
