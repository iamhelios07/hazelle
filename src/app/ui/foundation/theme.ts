export type Theme = 'dark' | 'light';

export const THEME: Record<Theme, string> = { dark: '어둡게', light: '밝게' };

// tokens.css styles :root[data-theme='light']; no attribute is the dark default.
export function applyTheme(theme: Theme) {
  if (theme === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
