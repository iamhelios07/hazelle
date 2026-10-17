import { useCallback, useRef } from 'react';
import type { ToolManifest } from '../../tool-api/manifest';
import { useDisplay } from '../display';
import { useSession, useTool } from '../session';
import { FrameSlot, ToolFrame } from '../ui';

type Props = { module: string; chat: string | null; title: string; onClose: () => void };

// A tool shows a page of its own: a page frame of its own, or a frame tool's one document.
export const opensPage = (manifest: ToolManifest) => manifest.page !== null || manifest.risu !== undefined;

export function ToolView({ module, chat, title, onClose }: Props) {
  const { tools } = useSession();
  const tool = useTool(module);
  const { display: { theme } } = useDisplay();
  const close = useRef(onClose);
  close.current = onClose;
  // New chat chunks change callbacks, never the frame. Another tool, chat or theme reloads it, unsaved page state and
  // all: the page reads its theme once, at its start.
  const mount = useCallback((window: Window) => tools.page(module, { window, chat, theme, close: () => close.current() }), [tools, module, chat, theme]);
  // A frame tool's document runs on with its listeners whether shown or not; theme never reloads it.
  const attach = useCallback((place: (frame: HTMLIFrameElement | null) => void) => tools.attach(module, { chat, place, close: () => close.current() }), [tools, module, chat]);
  if (tool?.value.manifest.risu !== undefined) return <FrameSlot key={`${module}:${chat}`} title={title} onMount={attach} />;
  return <ToolFrame key={`${module}:${chat}:${theme}`} title={title} onMount={mount} />;
}
