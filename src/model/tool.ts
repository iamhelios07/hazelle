import type { Json, Settings, ToolManifest } from '../tool-api/manifest';
import type { FileRef } from '../vault/files';
import { memoryId } from './memory';

export type Tool = { manifest: ToolManifest; file: FileRef; size: number; settings: Settings };
export type ToolData = { key: string; value: Json };
export type ToolUnit = { module: string; tool: Tool };
export const toolId = (module: string) => memoryId(module);
export const toolVar = (manifest: Pick<ToolManifest, 'author' | 'name'>, key: string) => `tool:${manifest.author}/${manifest.name}:${key}`;
