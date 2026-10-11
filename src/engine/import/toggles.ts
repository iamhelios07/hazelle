import type { ToggleLine } from '../../model/prompt';

// Risu's toggle text, one line each, `key=label=kind=option`: no kind or `check` is a check, `select=a,b` a choice
// whose value is the option's index as in Risu, `text` a typed value and `textarea` one of several lines. The layout
// lines (`=label=divider`, `=label=caption`, `=label=group` … `=label=groupEnd`) are read by kind first, as in Risu,
// so their empty key is no fault. Anything else is counted as unread rather than guessed at.
export function readToggles(text: string): { lines: ToggleLine[]; unread: number } {
  const lines: ToggleLine[] = [];
  let unread = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, label = '', kind, ...rest] = line.split('=').map((part) => part.trim());
    const options = kind === 'select' && rest.length === 1 ? rest[0]!.split(',').map((option) => option.trim()).filter(Boolean) : [];
    if (kind === 'group' || kind === 'divider') lines.push({ kind, label });
    // Risu ignores a lowercase groupend, so its group runs on; it is read as the end its writer meant.
    else if (kind === 'groupEnd' || kind === 'groupend') lines.push({ kind: 'groupEnd' });
    else if (kind === 'caption' && label) lines.push({ kind, label });
    else if (!key || !label) unread++;
    else if (kind === undefined || (kind === 'check' && rest.length === 0)) lines.push({ key, label, kind: 'check', default: '0' });
    else if (options.length) lines.push({ key, label, kind: 'choice', options, default: '0' });
    else if (kind === 'text') lines.push({ key, label, kind: 'text', default: '' });
    else if (kind === 'textarea') lines.push({ key, label, kind: 'text', lines: true, default: '' });
    else unread++;
  }
  return { lines, unread };
}
