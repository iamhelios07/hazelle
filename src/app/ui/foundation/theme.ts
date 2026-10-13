export type Theme = 'dark' | 'light';
export type Bg = 'base' | 'gray' | 'blue' | 'green' | 'brown';
export type Ink = 'base' | 'bright' | 'soft';
export type Accent = 'base' | 'rose' | 'blue' | 'green' | 'violet';

export const THEME: Record<Theme, string> = { dark: '어둡게', light: '밝게' };
// Each pick has a color per theme in tokens.css (--color-pick-*); base keeps the theme's own.
export const BG: Record<Bg, string> = { base: '기본', gray: '회색', blue: '파랑', green: '초록', brown: '갈색' };
export const INK: Record<Ink, string> = { base: '기본', bright: '선명하게', soft: '부드럽게' };
export const ACCENT: Record<Accent, string> = { base: '기본', rose: '분홍', blue: '파랑', green: '초록', violet: '보라' };

export type Scheme = { theme: Theme; bg: Bg; ink: Ink; accent: Accent };

// tokens.css turns its color tokens by these, on the document or on an element drawn in another scheme.
export const schemeAttributes = ({ theme, bg, ink, accent }: Scheme) => ({ 'data-theme': theme, 'data-bg': bg, 'data-ink': ink, 'data-accent': accent });

export function applyScheme(scheme: Scheme) {
  for (const [name, value] of Object.entries(schemeAttributes(scheme))) document.documentElement.setAttribute(name, value);
}
