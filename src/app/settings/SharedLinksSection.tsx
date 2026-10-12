import { useState } from 'react';
import { live } from '../../model/library';
import { cutShare, readShares } from '../../runtime/share';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { ago } from '../common/time';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { SHARE, UNKNOWN } from '../common/words';
import { useShares, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Empty, List, ListItem, Section } from '../ui';

// 설정 › 계정 › 공유한 링크: the server's links joined to the characters this account's vault names them by. A link no
// character here names, its character purged, is listed by what the server knows.
export function SharedLinksSection() {
  const store = useStore();
  const toast = useToast();
  const own = useShares();
  const loaded = useLoaded(readShares);
  const [cutting, setCutting] = useState<string | null>(null);

  async function cut(id: string) {
    setCutting(id);
    const done = await cutShare(store, id);
    setCutting(null);
    if (!done.ok) return toast.error('링크를 끊지 못했어요.', { detail: describeFailure(done) });
    toast.show('링크를 끊었어요.');
    loaded.reload();
  }

  const nameOf = (id: string) => {
    const parent = own.find(({ value }) => value.share === id)?.parent;
    return (parent && live(store.get('character', parent))?.value.card.name) ?? UNKNOWN;
  };
  const links = loaded.data?.shares;
  return (
    <Section title={SHARE.list}>
      {loaded.failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: loaded.reload }}>{loaded.failure}</Callout>}
      {links && links.length === 0 && <Empty variant="section">{SHARE.list}이 없어요.</Empty>}
      {links && links.length > 0 && (
        <List label={SHARE.list}>
          {links.map((link) => (
            <ListItem
              key={link.id}
              title={nameOf(link.id)}
              tags={link.removed ? [SHARE.removed] : link.held ? [SHARE.held] : []}
              description={`${SHARE.received} ${count(link.received)} · ${ago(link.createdAt)} 만듦`}
              control={
                <Button variant="secondary" size="sm" busy={cutting === link.id} disabled={cutting !== null} onClick={() => void cut(link.id)}>
                  {SHARE.cut}
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
}
