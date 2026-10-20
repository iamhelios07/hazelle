import { useState } from 'react';
import { day } from '../common/time';
import { NEWS, type News, type Tour } from '../common/release';
import { TOUR, TourDialog } from '../common/Tour';
import { SeeAll } from '../common/useLoaded';
import { Button, List, ListItem, Panel, Stack, Text } from '../ui';

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
  const [touring, setTouring] = useState<(News & { tour: Tour }) | null>(null);
  return (
    <>
      <List label={TITLE} box>
        {news.map((entry) => (
          <ListItem
            key={entry.version}
            title={entry.version}
            note={day(Date.parse(`${entry.date}T00:00`))}
            control={
              entry.tour && (
                <Button variant="secondary" size="sm" onClick={() => setTouring(entry as News & { tour: Tour })}>
                  {TOUR.see}
                </Button>
              )
            }
            detail={
              <Stack gap="related">
                {entry.lines.map((line) => (
                  <Text key={line}>{line}</Text>
                ))}
              </Stack>
            }
          />
        ))}
      </List>
      {touring && <TourDialog news={touring} onClose={() => setTouring(null)} />}
    </>
  );
}
