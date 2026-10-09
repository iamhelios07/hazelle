import type { PackOwner } from '../model/library';
import type { Trigger } from './import/types';

export type ScriptUnit = Trigger & { owner: PackOwner };
export type ModelRefusal = Hazelle.ModelRefusal;
export type ModelResult = { success: true; result: string } | { success: false; result: string; reason: ModelRefusal };

export type Question = Hazelle.Question;
export type ModelMessage = Hazelle.ModelMessage;

// What a script reaches outside its run, each of which may take as long as the user or a provider does.
export type Host = {
  say(kind: 'normal' | 'error', text: string, from: PackOwner): void;
  // input: the text typed; confirm: 'yes'; select: the option's index. null: dismissed.
  ask(question: Question, from: PackOwner, signal?: AbortSignal): Promise<string | null>;
  model(role: 'main' | 'aux', messages: ModelMessage[], spender: PackOwner, signal?: AbortSignal): Promise<ModelResult>;
  tokens(text: string): Promise<number>;
  // The lorebook entries a prompt built now would hold, each as sent, while their tokens fit within the model's
  // context less reserve; all of them when reserve is no number, as Risu's sum then never passes its limit.
  lore(reserve: number | null): Promise<{ role: 'system' | 'user' | 'assistant'; text: string }[]>;
};

export type EditStage = 'editInput' | 'editOutput' | 'editRequest';
export type ToolEvent =
  | { kind: 'reply'; index: number; id: string }
  | { kind: 'prompt' }
  | { kind: 'menu'; item: string };
export type Event =
  | ToolEvent
  | { kind: 'settings' }
  | { kind: 'input' | 'start' | 'output' }
  | { kind: 'button'; data: string }
  // A press on risu-trigger: each Lua script's own global function of that name, and each block trigger of that name
  // whatever its type, as Risu runs both.
  | { kind: 'call'; name: string }
  | { kind: 'edit'; stage: EditStage; value: unknown; meta: Record<string, unknown> };

// runaway: the CBS the script evaluated ran away (cbs/evaluate Runaway), which the app words as its other runaway
// notices; the message is only what the script itself sees.
export type Failure = { message: string } | { runaway: true };
export type ScriptError = { script: string; from: PackOwner } & Failure;

// index is a message's place in the snapshot. handled: some script had the function the event calls, or a block
// trigger answered it. missing: the functions called and the block effects met that this app does not have.
export type Outcome = {
  value: unknown;
  stop: boolean;
  handled: boolean;
  writes: [string, string][];
  edits: { index: number; text: string }[];
  removed: number[];
  added: { role: 'user' | 'char'; text: string }[];
  reload: boolean;
  errors: ScriptError[];
  missing: string[];
};


export const UNSET = 'null';
