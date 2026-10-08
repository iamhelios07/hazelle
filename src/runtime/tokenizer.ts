import { progressed } from '../engine/progress';

// o200k_base counts for every model, in the evaluation worker alone: no other realm imports this, so the page never
// downloads or holds its tables twice. Text that spells a special token counts as text.
// A load that fails here is reported by the send, translation or memory job that needs it.
export const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => (progressed(), countTokens(text, { disallowedSpecial: new Set() })));
