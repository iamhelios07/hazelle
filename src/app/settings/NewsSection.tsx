import { day } from '../common/time';
import { NEWS } from '../common/release';
import { Empty, List, ListItem, Panel, Stack, Text } from '../ui';

const TITLE = '새 소식';

// seek: the page was opened at it, from the toast saying this release came with news.
export function NewsSection({ seek }: { seek: boolean }) {
  return (
    <Panel title={TITLE} seek={seek}>
      {NEWS.length === 0 && <Empty variant="section">아직 {TITLE}이 없어요.</Empty>}
      {NEWS.length > 0 && (
        <List label={TITLE}>
          {NEWS.map(({ version, date, lines }) => (
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
      )}
    </Panel>
  );
}
