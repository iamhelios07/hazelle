import { useState } from 'react';
import { day } from '../common/time';
import { NEWS, type News } from '../common/release';
import { count } from '../common/typedNumber';
import { Button, Dialog, List, ListItem, Panel, Stack, Text } from '../ui';

const TITLE = '새 소식';
// The rest opens in a dialog, so the account page does not grow with every release.
const SHOWN = 3;

// seek: the page was opened at it, from the toast saying this release came with news.
export function NewsSection({ seek }: { seek: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <Panel
      title={TITLE}
      action={NEWS.length > SHOWN ? <Button variant="secondary" size="sm" onClick={() => setAll(true)}>{`모두 보기 (${count(NEWS.length)})`}</Button> : undefined}
      seek={seek}
    >
      <NewsList news={NEWS.slice(0, SHOWN)} />
      {all && (
        <Dialog title={TITLE} onClose={() => setAll(false)}>
          <NewsList news={NEWS} />
        </Dialog>
      )}
    </Panel>
  );
}

function NewsList({ news }: { news: News[] }) {
  return (
    <List label={TITLE} box>
      {news.map(({ version, date, lines }) => (
        <ListItem
          key={version}
          title={version}
          aside={day(Date.parse(`${date}T00:00`))}
          detail={
            <Stack gap="related">
              {lines.map((line) => (
                <Text key={line}>{line}</Text>
              ))}
            </Stack>
          }
        />
      ))}
    </List>
  );
}
