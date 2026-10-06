import { BookOpen, Braces } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { PromptSort } from '../../model/prompt';
import { noResults } from '../common/search';
import { COMMAND } from '../common/words';
import { Button, CodeBlock, Dialog, Empty, MarkupArea, Menu, MenuHeading, MenuItem, Row, SearchField, Stack, Text } from '../ui';
import { commandSnippet, COMMANDS, type Command } from './commands';
import type { Snippet } from './edits';
import { GUIDES, SAMPLE_NOTE, tryExample, type Example, type GuideId } from './guides';

type Props = { sort: PromptSort; onInsert: (snippet: Snippet) => void };

const LABEL = `${COMMAND} 삽입`;

export function CommandMenu({ sort, onInsert }: Props) {
  const [guide, setGuide] = useState<GuideId | null>(null);
  return (
    <>
      <Menu
        label={LABEL}
        place="below-end"
        size="lg"
        trigger={(opener) => (
          <Button variant="ghost" size="sm" icon={Braces} {...opener}>
            {LABEL}
          </Button>
        )}
      >
        <Commands sort={sort} onInsert={(command) => onInsert(commandSnippet(command))} onGuide={setGuide} />
      </Menu>
      {guide && <GuideDialog id={guide} onInsert={onInsert} onClose={() => setGuide(null)} />}
    </>
  );
}

const describe = ({ names, what, example }: Command) =>
  [what, example && `예: ${example[0]} → ${example[1]}`, names.length > 1 && `다른 이름: ${names.slice(1).join(', ')}`].filter(Boolean).join(' ');

// Mounted only while the menu is open, so each opening starts with an empty search.
function Commands({ sort, onInsert, onGuide }: { sort: PromptSort; onInsert: (command: Command) => void; onGuide: (id: GuideId) => void }) {
  const [query, setQuery] = useState('');
  const groups = COMMANDS.filter((group) => !group.sorts || group.sorts.includes(sort));
  const all = groups.flatMap((group) => group.commands);
  const often = all.filter((command) => command.uses?.[sort]);
  const words = query.trim().toLowerCase();
  const found = all.filter((command) => `${command.form} ${command.names.join(' ')} ${command.what}`.toLowerCase().includes(words));
  const item = (command: Command, sub = describe(command), key = command.form) => <MenuItem key={key} label={command.form} sub={sub} onClick={() => onInsert(command)} />;
  const guideItem = (id: GuideId, sub?: string) => <MenuItem key={`guide:${id}`} icon={BookOpen} label={`${GUIDES[id].title} 사용법`} sub={sub} onClick={() => onGuide(id)} />;

  return (
    <>
      <SearchField size="sm" label={`${COMMAND} 검색`} value={query} onChange={setQuery} />
      {words ? (
        found.length ? (
          <>
            <MenuHeading>검색 결과</MenuHeading>
            {found.map((command) => item(command))}
          </>
        ) : (
          <Empty variant="menu">{noResults(query.trim())}</Empty>
        )
      ) : (
        <>
          {guideItem('basics')}
          <MenuHeading>자주 쓰는 명령어</MenuHeading>
          {often.map((command) => item(command, command.uses![sort], `often:${command.form}`))}
          {groups.map((group) => (
            <Fragment key={group.title}>
              <MenuHeading>{group.title}</MenuHeading>
              {group.guide && guideItem(group.guide)}
              {group.commands.map((command) => item(command))}
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}

function GuideDialog({ id, onInsert, onClose }: { id: GuideId; onInsert: (snippet: Snippet) => void; onClose: () => void }) {
  const { title, steps } = GUIDES[id];
  const insert = (text: string) => {
    onInsert({ text, select: [text.length, text.length] });
    onClose();
  };
  return (
    <Dialog title={`${title} 사용법`} note={SAMPLE_NOTE} onClose={onClose}>
      <Stack gap="section">
        {steps.map(({ text, example }) => (
          <Stack key={text} gap="related">
            <Text>{text}</Text>
            {example && <Tryout example={example} onInsert={insert} />}
          </Stack>
        ))}
      </Stack>
    </Dialog>
  );
}

// The example stays editable, so the reader can change it and see what that gives.
function Tryout({ example, onInsert }: { example: Example; onInsert: (text: string) => void }) {
  const [written, setWritten] = useState(example.written);
  const result = tryExample(written, example.inMessage);
  return (
    <Stack gap="related">
      <MarkupArea label="예시" variant="field" value={written} onChange={setWritten} />
      <Text variant="note">{result === null ? '결과: 출력이 너무 길어서 중단됨' : result ? '결과' : '결과: 빈 텍스트'}</Text>
      {result && <CodeBlock variant="prose">{result}</CodeBlock>}
      <Row kind="actions">
        <Button variant="ghost" size="xs" onClick={() => onInsert(written)}>
          이 예시 삽입
        </Button>
      </Row>
    </Stack>
  );
}
