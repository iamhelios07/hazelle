// o200k_base counts for every model, loaded by the evaluation worker for turns and forecasts, and by translation/memory when needed. Text
// that spells a special token counts as text.
// A load that fails here is reported by the send or the translation that needs it.
export const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => countTokens(text, { disallowedSpecial: new Set() }));
