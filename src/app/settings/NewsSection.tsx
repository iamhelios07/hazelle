import { useState } from 'react';
import { day } from '../common/time';
import { NEWS, type News } from '../common/release';
import { SeeAll } from '../common/useLoaded';
import { List, ListItem, Panel, Stack, Text } from '../ui';

const TITLE = '새 소식';
const SHOWN = 3;

export function NewsSection({ seek }: { seek: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <Panel
      title={TITLE}
      action={NEWS.length > SHOWN ? <SeeAll total={NEWS.length} open={all} onClick={() => setAll((open) => !open)} /> : undefined}
      seek={seek}
    >
      <NewsList news={all ? NEWS : NEWS.slice(0, SHOWN)} />
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
          note={day(Date.parse(`${date}T00:00`))}
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
