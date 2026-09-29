import type { Toggle } from '../../model/prompt';

// Risu's toggle text, one toggle per line. Only `key=label` has been seen in real files, so it is the one form
// read; any other line that is not blank is counted as unread rather than guessed at.
export function readToggles(text: string): { toggles: Toggle[]; unread: number } {
  const toggles: Toggle[] = [];
  let unread = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('=').map((part) => part.trim());
    if (parts.length === 2 && parts[0] && parts[1]) toggles.push({ key: parts[0], label: parts[1], kind: 'check', default: '0' });
    else unread++;
  }
  return { toggles, unread };
}
