import type { ModelRef } from '../connectors/assignment';
import type { Receipt } from './chat';

// 마스코트 대사 (design §6.11): a mascot reads each reply and says one line with a picked face. The ids are stored on
// every remark, so a mascot or a face once shipped is never renamed or removed.
export const MASCOTS = {
  yeongae: { name: '영애', expressions: ['calm', 'thrilled', 'surprised', 'sad', 'angry', 'laughing', 'flustered', 'moved'] },
} as const satisfies Record<string, { name: string; expressions: readonly string[] }>;
export type MascotId = keyof typeof MASCOTS;
export type Expression<M extends MascotId = MascotId> = (typeof MASCOTS)[M]['expressions'][number];

// The only mascot until a second one ships; then 공용 gets the choice (design §6.11: the choice sits on 공용 only).
export const MASCOT: MascotId = 'yeongae';

// One per message version; a later remark on the same version replaces it. receipt: the 보조 call that wrote it.
export type Remark = {
  message: string;
  version: string;
  mascot: MascotId;
  expression: Expression;
  line: string;
  receipt: Receipt;
  model: ModelRef;
  at: number;
};
