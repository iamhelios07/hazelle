import type { ToolManifest } from '../../tool-api/manifest';

export type ToolMenu = { module: string; manifest: ToolManifest };
export type ToolPage = { window: Window; chat: string | null; theme: 'dark' | 'light'; close: () => void };
export type Tools = {
  warm(chat: string): Promise<void>;
  menus(chat: string): ToolMenu[];
  page(module: string, page: ToolPage): () => void;
  settingsChanged(module: string): void;
};

export const pendingTools = (): Tools => ({ warm: () => Promise.resolve(), menus: () => [], page: () => () => {}, settingsChanged: () => {} });
