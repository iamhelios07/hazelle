import { FolderPlus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import type { Lore, LoreFolder, LoreOwner } from '../../model/library';
import { loreGroups } from '../../model/lore';
import { loreBudgetOf } from '../../runtime/chat-context';
import { addLore, addLoreFolder, editLore, loreFolderRemoval, removeLore, removeLoreFolder, renameLoreFolder, restoreLore, restoreLoreFolder, setCharacterLoreBudget } from '../../runtime/lore';
import { useChildren, useStore, useStored } from '../session';
import { SHORTCUTS } from '../shortcuts';
import { useToast } from '../toast';
import { Button, ChipButton, ChoiceGroup, Empty, List, ListItem, Menu, MenuItem, MoreMenu, NumberInput, PhraseField, Row, Section, SettingGroup, SettingRow, Stack, Switch, Tag, Text, TextField, type CodeAside, type CodeLanguage } from '../ui';
import { ACTS, addOf } from './acts';
import { cbsLanguage } from './code/cbs';
import { cbsTrial } from './code/Trial';
import type { Defaults } from './code/variables';
import { NameDialog } from './NameDialog';
import { SLOT } from './prompt-words';
import { typedText } from './typed';
import { count, readOptional } from './typedNumber';
import { SAVE_STATUS, useAutosave } from './useAutosave';
import { useSearch } from './useSearch';
import { LORE_BUDGET_LABEL, loreName } from './words';

type Position = Lore['position'];
const POSITIONS: { value: NonNullable<Position> | 'lorebook'; label: string }[] = [
  { value: 'lorebook', label: `${SLOT.lorebook.name} 블록` },
  { value: 'before_char', label: `${SLOT.description.name} 앞` },
  { value: 'after_char', label: `${SLOT.description.name} 뒤` },
];
const NUMBER_ERROR = '숫자를 입력해 주세요.';
const NO_FOLDER = '폴더 없음';
const KEYS_SHOWN = 3;

const readNumber = (draft: string) => readOptional(draft, false);
// undefined: empty, which follows the account's value.
const readBudget = (draft: string) => {
  const typed = readOptional(draft, true);
  return typed === null || (typed !== undefined && typed < 1) ? null : typed;
};
const budgetText = (value: number | undefined) => (value === undefined ? '' : String(value));

function LoreBudgetRow({ id }: { id: string }) {
  const store = useStore();
  const stored = useStored('character', id);
  const save = useAutosave<{ tokenBudget: number | null }>(`character-lore-budget:${id}`, ({ tokenBudget = null }) => setCharacterLoreBudget(store, id, tokenBudget));
  const [typed, setTyped] = useState<string>();
  const own = (save.unsaved.tokenBudget === undefined ? (stored?.value.card.loreSettings.tokenBudget ?? null) : save.unsaved.tokenBudget) ?? undefined;
  const draft = typedText(typed, readBudget, own, budgetText);
  const invalid = readBudget(draft) === null;
  const shared = count(loreBudgetOf(store));
  const type = (next: string) => {
    setTyped(next);
    const value = readBudget(next);
    if (value !== null) save.change({ tokenBudget: value ?? null });
  };
  return (
    <SettingRow
      label={LORE_BUDGET_LABEL}
      help={`이 캐릭터와 대화할 때만 적용돼요. 비워 두면 설정의 공용 값(${shared} 토큰)을 따라요.`}
      changed={own !== undefined}
      error={invalid ? '1 이상의 정수를 입력해 주세요.' : undefined}
      control={<NumberInput label={LORE_BUDGET_LABEL} unit="토큰" value={draft} invalid={invalid} placeholder={shared} onChange={type} />}
    />
  );
}

function when({ enabled, constant, keys }: Lore) {
  const named = keys.filter((key) => key.trim());
  const more = named.length > KEYS_SHOWN ? ` 외 ${named.length - KEYS_SHOWN}개` : '';
  return !enabled ? '꺼짐' : constant ? '항상' : named.length ? named.slice(0, KEYS_SHOWN).join(', ') + more : '키워드 없음';
}

type Naming = { folder: LoreFolder | null; name: string };

// folders: the owner's loreFolders as stored now. variables: a character's 기본 변수, offered in an entry's text.
export function LoreEditor({ owner, folders, variables }: { owner: LoreOwner; folders: LoreFolder[]; variables?: Defaults }) {
  const store = useStore();
  const language = useMemo(() => cbsLanguage({ variables }), [variables]);
  const trial = useMemo(() => cbsTrial(owner), [owner.kind, owner.id]);
  const toast = useToast();
  const entries = useChildren('lore', owner.id);
  const groups = useMemo(() => loreGroups(entries, folders), [entries, folders]);
  const [added, setAdded] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);

  // The entry's row mounts as the store takes it, so it is named as added before then.
  async function add(folder: string | null) {
    const id = crypto.randomUUID();
    setAdded(id);
    const saved = await addLore(store, owner.id, folder, id);
    if (!saved.ok) toast.failed(saved, '항목을 추가하지 못했어요.');
  }

  function saveFolder({ folder, name }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    void (folder ? renameLoreFolder(store, owner, folder.id, trimmed) : addLoreFolder(store, owner, trimmed)).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  function removeFolder(folder: LoreFolder) {
    const removal = loreFolderRemoval(store, owner, folder.id);
    if (!removal) return;
    void removeLoreFolder(store, owner, removal).then((removed) => removed.ok || toast.failed(removed, '폴더를 삭제하지 못했어요.'));
    const held = removal.entries.length;
    toast.undoable(
      `'${folder.name}' 폴더를 삭제했어요.`,
      () => restoreLoreFolder(store, owner, removal),
      held > 0 ? `항목 ${held}개는 폴더 밖으로 꺼냈어요.` : undefined,
    );
  }

  const rows = (list: readonly Stored<'lore'>[]) => list.map((entry) => <EntryRow key={entry.id} stored={entry} folders={folders} language={language} trial={trial} startOpen={entry.id === added} />);
  const [loose, ...grouped] = groups;
  const search = useSearch(entries, '로어북 검색', ({ value }) => [loreName(value.name), ...value.keys]);
  const listed = search.words ? (
    search.none === null ? (
      <List box label="찾은 로어북 항목">
        {rows(search.found)}
      </List>
    ) : (
      <Empty variant="section">{search.none}</Empty>
    )
  ) : entries.length === 0 && folders.length === 0 ? (
    <Empty variant="section">항목이 없어요.</Empty>
  ) : (
    <List box label="로어북 항목">
      {rows(loose!.entries)}
      {grouped.map(({ folder, entries: inside }) => (
        <FolderItem
          key={folder!.id}
          name={folder!.name}
          count={inside.length}
          menu={
            <>
              <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ folder, name: folder!.name })} />
              <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => removeFolder(folder!)} />
            </>
          }
        >
          {inside.length > 0 && <List label={`${folder!.name} 항목`}>{rows(inside)}</List>}
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add(folder!.id)}>
              {addOf('항목')}
            </Button>
          </Row>
        </FolderItem>
      ))}
    </List>
  );
  return (
    <Section title={owner.kind === 'chat' ? '항목' : '로어북'} note={`${entries.length}개`} help={`대화에 키워드가 나오면 그 항목의 내용이 프롬프트에 들어가요.${owner.kind === 'chat' ? ' 지금 이 채팅에서만 쓰여요.' : ''}`}>
      <Stack gap="related">
        {owner.kind === 'character' && <LoreBudgetRow id={owner.id} />}
        {search.field}
        {listed}
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add(null)}>
            {addOf('항목')}
          </Button>
          <Button variant="secondary" size="sm" icon={FolderPlus} onClick={() => setNaming({ folder: null, name: '' })}>
            새 폴더
          </Button>
        </Row>
      </Stack>
      {naming && <NameDialog title={naming.folder ? '폴더 이름 바꾸기' : '새 폴더'} value={naming.name} onSave={(name) => saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />}
    </Section>
  );
}

function FolderItem({ name, count, menu, children }: { name: string; count: number; menu: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <ListItem title={name} aside={`${count}개`} expanded={open} onClick={() => setOpen(!open)} control={<MoreMenu of={`'${name}'`}>{menu}</MoreMenu>} detail={open && <Stack gap="related">{children}</Stack>} />;
}

type RowProps = { stored: Stored<'lore'>; folders: LoreFolder[]; language: CodeLanguage; trial: (text: string) => CodeAside; startOpen: boolean };

// Its edits wait in its own save queue, so the line shows them before they are stored.
function EntryRow({ stored, folders, language, trial, startOpen }: RowProps) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Lore>(`lore:${stored.id}`, (patch) => editLore(store, stored.id, patch));
  const shown: Lore = { ...stored.value, ...save.unsaved };
  const [open, setOpen] = useState(startOpen);

  async function remove() {
    const done = await save.remove(() => removeLore(store, stored.id));
    if (!done) return;
    if (!done.ok) return toast.failed(done, '삭제하지 못했어요.');
    toast.undoable(`'${loreName(shown.name)}' 항목을 삭제했어요.`, () => restoreLore(store, done.data));
  }

  return (
    <ListItem
      title={loreName(shown.name)}
      trailing={<Tag>{when(shown)}</Tag>}
      expanded={open}
      onClick={() => setOpen(!open)}
      detail={open && <EntryFields shown={shown} folders={folders} language={language} trial={trial} change={save.change} status={save.status} remove={() => void remove()} />}
    />
  );
}

type FieldsProps = {
  shown: Lore;
  folders: LoreFolder[];
  language: CodeLanguage;
  trial: (text: string) => CodeAside;
  change: (patch: Partial<Lore>, valid?: boolean) => void;
  status: keyof typeof SAVE_STATUS | null;
  remove: () => void;
};

function EntryFields({ shown, folders, language, trial, change, status, remove }: FieldsProps) {
  const [typed, setTyped] = useState<{ order?: string; priority?: string }>({});
  const order = typedText(typed.order, (draft) => readNumber(draft) ?? null, shown.insertionOrder, String);
  const priority = typedText(typed.priority, readNumber, shown.priority ?? undefined, (value) => (value === undefined ? '' : String(value)));
  const orderValid = typeof readNumber(order) === 'number';
  const priorityValid = readNumber(priority) !== null;
  const folder = folders.find(({ id }) => id === shown.folder);

  function changeOrder(draft: string) {
    setTyped((current) => ({ ...current, order: draft }));
    const value = readNumber(draft);
    change({ insertionOrder: value ?? 0 }, typeof value === 'number');
  }

  function changePriority(draft: string) {
    setTyped((current) => ({ ...current, priority: draft }));
    const value = readNumber(draft);
    change({ priority: value ?? null }, value !== null);
  }

  const toggle = (field: 'enabled' | 'constant' | 'selective' | 'useRegex' | 'caseSensitive', label: string, help?: string) => (
    <SettingRow label={label} help={help} control={<Switch label={label} checked={shown[field]} onChange={(on) => change({ [field]: on })} />} />
  );

  return (
    <Stack gap="group">
      <TextField label="이름" value={shown.name} onChange={(name) => change({ name })} />
      <SettingGroup label="키워드">
        <SettingRow label="키워드" help="최근 대화에 이 중 하나라도 나오면 내용이 프롬프트에 들어가요." wide control={<PhraseField label="키워드" phrases={shown.keys} onChange={(keys) => change({ keys })} />} />
        {toggle('selective', '보조 키워드 사용', '키워드 하나와 보조 키워드 하나가 함께 나와야 프롬프트에 들어가요.')}
        {shown.selective && (
          <SettingRow label="보조 키워드" wide control={<PhraseField label="보조 키워드" phrases={shown.secondaryKeys} onChange={(secondaryKeys) => change({ secondaryKeys })} />} />
        )}
        {toggle('useRegex', '정규식 사용', '키워드를 /패턴/ 또는 /패턴/플래그 형식의 정규식으로 인식해요.')}
        {toggle('caseSensitive', '대소문자 구분')}
      </SettingGroup>
      <TextField label="내용" lines={8} expand={SHORTCUTS.bigEdit.keys} language={language} aside={trial} value={shown.content} onChange={(content) => change({ content })} help="@@로 시작하는 줄은 삽입 방식을 정하는 명령이에요. 예: @@depth 0" />
      <SettingGroup label="삽입">
        {toggle('enabled', '켬')}
        {toggle('constant', '항상 삽입', '키워드와 상관없이 항상 넣어요.')}
        <SettingRow
          label="순서"
          help="숫자가 클수록 프롬프트 뒤쪽에 들어가요."
          error={orderValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="순서" value={order} invalid={!orderValid} onChange={changeOrder} />}
        />
        <SettingRow
          label="우선순위"
          help="로어북 최대 분량을 넘으면 숫자가 큰 항목부터 먼저 넣어요."
          changed={shown.priority !== null}
          error={priorityValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="우선순위" value={priority} placeholder="순서와 같음" invalid={!priorityValid} onChange={changePriority} />}
        />
        <SettingRow
          label="위치"
          help={`${SLOT.lorebook.name}을 프롬프트의 ${SLOT.lorebook.name} 블록에 넣을지, 아니면 ${SLOT.description.name} 블록의 맨 앞이나 맨 뒤에 넣을지 정해요.`}
          control={<ChoiceGroup label="위치" options={POSITIONS} value={shown.position ?? 'lorebook'} onChange={(value) => change({ position: value === 'lorebook' ? null : value })} />}
        />
        {folders.length > 0 && (
          <SettingRow
            label="폴더"
            control={
              <Menu place="below-end" label="폴더" trigger={(opener) => <ChipButton variant="field" label={folder?.name ?? NO_FOLDER} title="폴더" {...opener} />}>
                <MenuItem label={NO_FOLDER} checked={!folder} onClick={() => change({ folder: null })} />
                {folders.map((each) => (
                  <MenuItem key={each.id} label={each.name} checked={each.id === folder?.id} onClick={() => change({ folder: each.id })} />
                ))}
              </Menu>
            }
          />
        )}
      </SettingGroup>
      <Row kind="spread">
        <Text variant="note">{status ? SAVE_STATUS[status] : ''}</Text>
        <Button variant="danger" size="sm" onClick={remove}>
          이 항목 삭제
        </Button>
      </Row>
    </Stack>
  );
}
