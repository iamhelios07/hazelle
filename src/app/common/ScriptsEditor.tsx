import { ChevronDown, ChevronLeft, ChevronUp, Plus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Pack, RegexScript, Trigger } from '../../engine/import/types';
import { checkScript, trySample, type ScriptCheck } from '../../engine/regex/scripts';
import type { ApiResult } from '../../runtime/api';
import { addLua, addRegex, editRegex, editTrigger, moveScript, neighbour, removeScript, restoreScript, setScriptOff, type PackOwner, type RemovedScript, type ScriptList } from '../../runtime/pack';
import { useStore } from '../session';
import { useToast } from '../toast';
import { Button, ChoiceGroup, Disclosure, Empty, IconButton, List, ListItem, Row, SearchField, Section, SettingGroup, SettingRow, Stack, Switch, Tag, Text, TextField } from '../ui';
import { matches, noResults, SEARCH_FROM } from './search';
import { SAVE_STATUS, useAutosave } from './useAutosave';
import { scriptName, SCRIPTS, STAGES } from './words';

type Lua = Extract<Trigger, { kind: 'lua' }>;
type Blocks = Extract<Trigger, { kind: 'blocks' }>;

const STAGE_OPTIONS = (Object.keys(STAGES) as RegexScript['stage'][]).map((value) => ({ value, label: STAGES[value] }));
const CHECKS: Record<ScriptCheck, string> = { empty: '패턴 없음', invalid: '패턴 오류', unsupported: '지원하지 않음' };
const ON: Record<string, string> = { start: '채팅 시작', input: STAGES.input, output: STAGES.output, manual: '버튼' };
const OFF = '꺼짐';

// One script open at a time. drill: the open script stands alone in place of the lists, for a narrow panel or page.
// status: the ids of the character's 상태창 지정 scripts, tagged in its list.
export function ScriptsEditor({ owner, pack, drill, status = [] }: { owner: PackOwner; pack: Pack; drill: boolean; status?: readonly string[] }) {
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [words, setWords] = useState('');
  // Lua code typed and not applied yet, by script; it goes when the editor does.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());

  // The script opens as added, before the store holds it.
  async function add(list: ScriptList) {
    const id = crypto.randomUUID();
    setOpen(id);
    const saved = await (list === 'regex' ? addRegex : addLua)(store, owner, id);
    if (!saved.ok) toast.failed(saved, '추가하지 못했어요.');
  }

  const draft = (id: string, code: string | null) =>
    setDrafts((current) => {
      const next = new Map(current);
      if (code === null) next.delete(id);
      else next.set(id, code);
      return next;
    });

  const item = (list: ScriptList, id: string, page: boolean) => {
    const place = pack[list].findIndex((script) => script.id === id);
    const shared = { owner, pack, place, page, open: page || open === id, onOpen: (on: boolean) => setOpen(on ? id : null) };
    if (list === 'regex') return <RegexItem key={id} {...shared} script={pack.regex[place]!} status={status.includes(id)} searched={words.trim() !== ''} />;
    const trigger = pack.triggers[place]!;
    return trigger.kind === 'lua' ? <LuaItem key={id} {...shared} trigger={trigger} draft={drafts.get(id) ?? null} onDraft={(code) => draft(id, code)} /> : <BlocksItem key={id} {...shared} trigger={trigger} />;
  };

  const opened = drill && open !== null ? (['regex', 'triggers'] as const).find((list) => pack[list].some((script) => script.id === open)) : undefined;
  if (opened && open)
    return (
      <Stack gap="related">
        <Row kind="toolbar">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => setOpen(null)}>
            {`${SCRIPTS.part} 목록`}
          </Button>
        </Row>
        {item(opened, open, true)}
      </Stack>
    );

  const searching = words.trim() !== '';
  const found = searching
    ? [
        ...pack.regex.filter((script) => matches(words, script.name, script.find)).map(({ id }) => item('regex', id, false)),
        ...pack.triggers.filter((trigger) => matches(words, trigger.name, trigger.kind === 'lua' ? trigger.code : '')).map(({ id }) => item('triggers', id, false)),
      ]
    : [];
  const lists = (
    <>
      <Section title={SCRIPTS.regex} note={`${pack.regex.length}개`}>
        <Stack gap="related">
          {pack.regex.length === 0 && <Empty variant="section">{`${SCRIPTS.regex}이 없어요.`}</Empty>}
          {STAGE_OPTIONS.map(({ value: stage, label }) => {
            const staged = pack.regex.filter((script) => script.stage === stage);
            return (
              staged.length > 0 && (
                <Section key={stage} level={3} title={label} note={`${staged.length}개`}>
                  <List box label={`${label} ${SCRIPTS.regex}`}>{staged.map(({ id }) => item('regex', id, false))}</List>
                </Section>
              )
            );
          })}
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add('regex')}>
              {`${SCRIPTS.regex} 추가`}
            </Button>
          </Row>
        </Stack>
      </Section>
      <Section title={SCRIPTS.triggers} note={`${pack.triggers.length}개`}>
        <Stack gap="related">
          {pack.triggers.length > 0 ? (
            <List box label={SCRIPTS.triggers}>{pack.triggers.map(({ id }) => item('triggers', id, false))}</List>
          ) : (
            <Empty variant="section">{`${SCRIPTS.triggers}가 없어요.`}</Empty>
          )}
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add('triggers')}>
              Lua 추가
            </Button>
          </Row>
        </Stack>
      </Section>
    </>
  );
  // The search box keeps its place whether it shows what it found or the lists, so typing in it never moves it.
  return (
    <>
      {(searching || pack.regex.length + pack.triggers.length >= SEARCH_FROM) && <SearchField size="sm" label={`${SCRIPTS.part} 검색`} value={words} onChange={setWords} />}
      {!searching ? (
        lists
      ) : found.length > 0 ? (
        <List box label={`찾은 ${SCRIPTS.part}`}>
          {found}
        </List>
      ) : (
        <Empty variant="section">{noResults(words)}</Empty>
      )}
    </>
  );
}

type ItemProps = { owner: PackOwner; pack: Pack; place: number; page: boolean; open: boolean; onOpen: (open: boolean) => void };

// A row of its list that opens in place, or with page the open script alone.
function Item({ page, open, onOpen, title, tag, aside, children }: Pick<ItemProps, 'page' | 'open' | 'onOpen'> & { title: string; tag: string | null; aside?: string; children: ReactNode }) {
  if (page)
    return (
      <Section title={title} seek>
        {children}
      </Section>
    );
  return <ListItem title={title} aside={aside} trailing={tag && <Tag>{tag}</Tag>} expanded={open} onClick={() => onOpen(!open)} detail={open && <Stack gap="group">{children}</Stack>} />;
}

type Removal = Promise<ApiResult<RemovedScript>>;

// What every script has once open: its switch, its order, its save state and its delete. remove: through the script's
// save queue, so a save still waiting never writes after the delete.
function useScriptActions({ owner, pack, onOpen }: ItemProps, list: ScriptList, script: { id: string; off?: true }, name: string, remove: (task: () => Removal) => Promise<Awaited<Removal> | null>) {
  const store = useStore();
  const toast = useToast();
  const failed = (saved: ApiResult<unknown>) => saved.ok || toast.failed(saved, '저장하지 못했어요.');

  async function drop() {
    const done = await remove(() => removeScript(store, owner, list, script.id));
    if (!done) return;
    if (!done.ok) return toast.failed(done, '삭제하지 못했어요.');
    onOpen(false);
    toast.undoable(`'${name}' ${SCRIPTS[list]}${list === 'regex' ? '을' : '를'} 삭제했어요.`, () => void restoreScript(store, owner, done.data).then((restored) => restored.ok || toast.failed(restored, '되돌리지 못했어요.')));
  }

  const move = (by: -1 | 1, icon: LucideIcon, label: string) => (
    <IconButton icon={icon} size="sm" label={label} disabled={neighbour(pack, list, script.id, by) === null} onClick={() => void moveScript(store, owner, list, script.id, by).then(failed)} />
  );
  return (status: keyof typeof SAVE_STATUS | null) => (
    <>
      <SettingGroup label="켬">
        <SettingRow label="켬" control={<Switch label="켬" checked={!script.off} onChange={(on) => void setScriptOff(store, owner, list, script.id, !on).then(failed)} />} />
      </SettingGroup>
      <Row kind="spread">
        <Row kind="toolbar">
          {move(-1, ChevronUp, '위로')}
          {move(1, ChevronDown, '아래로')}
          <Text variant="note">{status ? SAVE_STATUS[status] : ''}</Text>
        </Row>
        <Button variant="danger" size="sm" onClick={() => void drop()}>
          삭제
        </Button>
      </Row>
    </>
  );
}

function RegexItem(props: ItemProps & { script: RegexScript; status: boolean; searched: boolean }) {
  const { owner, place, script, status, searched } = props;
  const store = useStore();
  const save = useAutosave<RegexScript>(`script:${owner.id}:${script.id}`, (patch) => editRegex(store, owner, script.id, patch));
  const shown: RegexScript = { ...script, ...save.unsaved };
  const name = scriptName(shown.name, 'regex', place);
  const check = checkScript(shown);
  const actions = useScriptActions(props, 'regex', script, name, save.remove);
  const [sample, setSample] = useState('');
  const tag = shown.off ? OFF : check ? CHECKS[check] : status ? '상태창' : null;
  return (
    <Item {...props} title={name} tag={tag} aside={searched ? STAGES[shown.stage] : undefined}>
      <TextField label="이름" value={shown.name} onChange={(value) => save.change({ name: value })} />
      <ChoiceGroup label="단계" showLabel options={STAGE_OPTIONS} value={shown.stage} onChange={(stage) => save.change({ stage })} />
      <TextField label="패턴" kind="key" lines={2} value={shown.find} onChange={(find) => save.change({ find })} error={check === 'invalid' ? '패턴이 올바르지 않아요.' : undefined} />
      <TextField
        label="바꿀 내용"
        kind="key"
        lines={6}
        value={shown.replace}
        onChange={(replace) => save.change({ replace })}
        error={check === 'unsupported' ? '@@emo는 지원하지 않아요.' : undefined}
      />
      <Disclosure label="고급">
        <TextField label="플래그" kind="key" value={shown.flags ?? ''} placeholder="g" onChange={(flags) => save.change({ flags: flags || null })} />
      </Disclosure>
      <Disclosure label="시험해 보기">
        <Stack gap="related">
          <TextField label="예시 텍스트" lines={3} value={sample} onChange={setSample} />
          <TextField label="결과" kind="key" lines={3} readOnly value={sample && trySample(shown, sample)} onChange={() => {}} />
        </Stack>
      </Disclosure>
      {actions(save.status)}
    </Item>
  );
}

// Its code is stored only on 적용, never as it is typed, since a chat beside it runs what is stored.
function LuaItem(props: ItemProps & { trigger: Lua; draft: string | null; onDraft: (code: string | null) => void }) {
  const { owner, place, trigger, draft, onDraft } = props;
  const store = useStore();
  const save = useAutosave<Lua>(`script:${owner.id}:${trigger.id}`, (patch) => editTrigger(store, owner, trigger.id, patch));
  const shown: Lua = { ...trigger, ...save.unsaved };
  const name = scriptName(shown.name, 'triggers', place);
  const actions = useScriptActions(props, 'triggers', trigger, name, save.remove);
  const code = draft ?? shown.code;
  const pending = draft !== null && draft !== shown.code;

  async function apply() {
    if (await save.save({ code })) onDraft(null);
  }

  const tag = shown.off ? OFF : pending ? '적용 전' : !shown.code.trim() ? '코드 없음' : null;
  return (
    <Item {...props} title={name} tag={tag}>
      <TextField label="이름" value={shown.name} onChange={(value) => save.change({ name: value })} />
      <TextField label="코드" kind="key" lines={20} value={code} onChange={onDraft} />
      <Row kind="actions">
        <Button variant="primary" size="sm" disabled={!pending} onClick={() => void apply()}>
          적용
        </Button>
      </Row>
      {actions(save.status)}
    </Item>
  );
}

// Read only but for its order, its switch and its delete: no editor builds these yet.
function BlocksItem(props: ItemProps & { trigger: Blocks }) {
  const { trigger, place } = props;
  const name = scriptName(trigger.name, 'triggers', place);
  const actions = useScriptActions(props, 'triggers', trigger, name, (task) => task());
  return (
    <Item {...props} title={name} tag={trigger.off ? OFF : null} aside={ON[trigger.on] ?? trigger.on}>
      <Text variant="note">{`조건 ${trigger.conditions.length}개 · 효과 ${trigger.effects.length}개`}</Text>
      {actions(null)}
    </Item>
  );
}
