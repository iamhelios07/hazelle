// o200k_base counts for every model, loaded when a chat opens rather than with the page. Text
// that spells a special token counts as text.
export const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => countTokens(text, { disallowedSpecial: new Set() }));

// A load that fails here is reported by the send or the translation that needs it.
export const preloadTokenizer = () => void tokenizer().catch(() => {});
