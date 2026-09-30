import type { Toggle } from '../../model/prompt';

// Risu's toggle text, one toggle per line: `key=label` or `key=label=check` is a check, `key=label=select=a,b` a
// choice, whose value is the option's index as in Risu. Text toggles and the layout lines (divider, caption, group)
// have nothing to become here, so they are counted as unread with any other line rather than guessed at.
export function readToggles(text: string): { toggles: Toggle[]; unread: number } {
  const toggles: Toggle[] = [];
  let unread = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, label, kind, ...rest] = line.split('=').map((part) => part.trim());
    const options = kind === 'select' && rest.length === 1 ? rest[0]!.split(',').map((option) => option.trim()).filter(Boolean) : [];
    if (!key || !label) unread++;
    else if (kind === undefined || (kind === 'check' && rest.length === 0)) toggles.push({ key, label, kind: 'check', default: '0' });
    else if (options.length) toggles.push({ key, label, kind: 'choice', options, default: '0' });
    else unread++;
  }
  return { toggles, unread };
}
