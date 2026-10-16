import { useEffect, useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { MascotFailure } from '../../runtime/mascot';
import { describeMascotFailure } from '../common/failure';
import { useChildren, useCommenting } from '../session';
import { useToast } from '../toast';

// Said once, though the chat is left and opened again.
const told = new WeakSet<MascotFailure>();
// Fresh (design §6.11: the mark sways until opened once): written after this page loaded and not opened since.
// Page memory only, so a reload counts every line as seen.
const loaded = Date.now();
const seen = new Set<string>();

// A version's line, the newest when a replaced one still shows before its removal syncs.
function remarksByVersion(remarks: Stored<'remark'>[]): ReadonlyMap<string, Stored<'remark'>> {
  const versions = new Map<string, Stored<'remark'>>();
  for (const remark of remarks) {
    const held = versions.get(remark.value.version);
    if (!held || held.value.at < remark.value.at) versions.set(remark.value.version, remark);
  }
  return versions;
}

export function useChatRemarks(chatId: string, id: string | null) {
  const toast = useToast();
  const stored = useChildren('remark', id);
  const remarks = useMemo(() => remarksByVersion(stored), [stored]);
  const commenting = useCommenting();
  const [, setSeen] = useState(0);

  useEffect(() => {
    for (const entry of commenting.values()) {
      if (entry.chat !== chatId || !entry.failure || told.has(entry.failure)) continue;
      told.add(entry.failure);
      toast.error(describeMascotFailure(entry.failure));
    }
  }, [commenting]);

  return {
    remarks,
    fresh: (remark: Stored<'remark'>) => remark.value.at > loaded && !seen.has(remark.id),
    actions: {
      seeRemark: (remark: string) => {
        seen.add(remark);
        setSeen((count) => count + 1);
      },
    },
  };
}
