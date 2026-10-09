import type { Json, Settings, ToolManifest } from '../tool-api/manifest';
import type { FileRef } from '../vault/files';

export type Tool = { manifest: ToolManifest; file: FileRef; size: number; settings: Settings };
export type ToolData = { key: string; value: Json };
// One tool's data for one chat (Hazelle.ChatData). key null: the badges the host keeps for the tool there, a Badges.
export type ToolChatData = { module: string; key: string | null; value: Json };
export type Badges = Record<string, { version: string; text: string }>;
export type ToolUnit = { module: string; tool: Tool };
export const toolId = (module: string) => module.replace(/^[0-9a-f]{8}/, (group) => (0xffffffff - parseInt(group, 16)).toString(16).padStart(8, '0'));
export const toolVar = (manifest: Pick<ToolManifest, 'author' | 'name'>, key: string) => `tool:${manifest.author}/${manifest.name}:${key}`;
