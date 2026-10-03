import { FolderPlus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { Lore, LoreFolder } from '../../model/library';
import { loreGroups } from '../../model/lore';
import { addLore, addLoreFolder, editLore, removeLore, removeLoreFolder, renameLoreFolder, restoreLore, restoreLoreFolder, type LoreOwner } from '../../runtime/lore';
import { useChildren, useStore } from '../session';
import { useToast } from '../toast';
import { Button, ChipButton, ChoiceGroup, Disclosure, Empty, Menu, MenuItem, NumberInput, PhraseField, Row, Section, SettingGroup, SettingRow, Stack, Switch, Text, TextField } from '../ui';
import { NameDialog } from './NameDialog';
import { SLOT_NAMES } from './prompt-words';
import { typedText } from './typed';
import { SAVE_STATUS, useAutosave } from './useAutosave';
import { loreName } from './words';

type Position = Lore['position'];
const POSITIONS: { value: NonNullable<Position> | 'lorebook'; label: string }[] = [
  { value: 'lorebook', label: `${SLOT_NAMES.lorebook} 자리` },
  { value: 'before_char', label: `${SLOT_NAMES.description} 앞` },
  { value: 'after_char', label: `${SLOT_NAMES.description} 뒤` },
];
const NUMBER_ERROR = '숫자를 적어 주세요.';
const NO_FOLDER = '폴더 없음';
const KEYS_SHOWN = 3;

// undefined: left empty. null: not a number.
const readNumber = (draft: string) => {
  if (draft.trim() === '') return undefined;
  const value = Number(draft);
  return Number.isFinite(value) ? value : null;
};

function summary({ name, enabled, constant, keys }: Lore) {
  const named = keys.filter((key) => key.trim());
  const more = named.length > KEYS_SHOWN ? ` 외 ${named.length - KEYS_SHOWN}개` : '';
  const when = !enabled ? '꺼짐' : constant ? '항상' : named.length ? named.slice(0, KEYS_SHOWN).join(', ') + more : '키워드 없음';
  return `${loreName(name)} · ${when}`;
}

type Naming = { folder: LoreFolder | null; name: string };

// folders: the owner's loreFolders as stored now.
export function LoreEditor({ owner, folders }: { owner: LoreOwner; folders: LoreFolder[] }) {
  const store = useStore();
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
    if (!saved.ok) toast.failed(saved, '항목을 더하지 못했어요.');
  }

  function saveFolder({ folder, name }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    void (folder ? renameLoreFolder(store, owner, folder.id, trimmed) : addLoreFolder(store, owner, trimmed)).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  async function removeFolder(folder: LoreFolder, held: number) {
    const removed = await removeLoreFolder(store, owner, folder.id);
    if (!removed.ok) return toast.failed(removed, '폴더를 지우지 못했어요.');
    toast.undoable(
      `‘${folder.name}’ 폴더를 지웠어요.`,
      () => void restoreLoreFolder(store, owner, removed.data).then((restored) => restored.ok || toast.failed(restored, '되돌리지 못했어요.')),
      held > 0 ? `항목 ${held}개는 폴더 밖으로 옮겼어요.` : undefined,
    );
  }

  const rows = (list: Stored<'lore'>[]) => list.map((entry) => <EntryRow key={entry.id} stored={entry} folders={folders} startOpen={entry.id === added} />);
  const [loose, ...grouped] = groups;
  return (
    <Section title="로어북" note={`${entries.length}개`} hint="대화에 키워드가 나오면 그 항목의 내용이 프롬프트에 들어가요.">
      <Stack gap="related">
        {entries.length === 0 && folders.length === 0 && <Empty variant="section">아직 항목이 없어요.</Empty>}
        {rows(loose!.entries)}
        {grouped.map(({ folder, entries: inside }) => (
          <Disclosure key={folder!.id} label={`${folder!.name} · ${inside.length}개`}>
            {rows(inside)}
            <Row kind="actions">
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add(folder!.id)}>
                새 항목
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setNaming({ folder, name: folder!.name })}>
                이름 바꾸기
              </Button>
              <Button variant="danger" size="sm" onClick={() => void removeFolder(folder!, inside.length)}>
                폴더 지우기
              </Button>
            </Row>
          </Disclosure>
        ))}
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add(null)}>
            새 항목
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

type RowProps = { stored: Stored<'lore'>; folders: LoreFolder[]; startOpen: boolean };

// Its edits wait in its own save queue, so the line shows them before they are stored.
function EntryRow({ stored, folders, startOpen }: RowProps) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Lore>(`lore:${stored.id}`, (patch) => editLore(store, stored.id, patch));
  const shown: Lore = { ...stored.value, ...save.unsaved };

  async function remove() {
    const done = await save.remove(() => removeLore(store, stored.id));
    if (!done) return;
    if (!done.ok) return toast.failed(done, '지우지 못했어요.');
    toast.undoable(`‘${loreName(shown.name)}’ 항목을 지웠어요.`, () => void restoreLore(store, done.data).then((restored) => restored.ok || toast.failed(restored, '되돌리지 못했어요.')));
  }

  return (
    <Disclosure label={summary(shown)} startOpen={startOpen}>
      <EntryFields shown={shown} folders={folders} change={save.change} status={save.status} remove={() => void remove()} />
    </Disclosure>
  );
}

type FieldsProps = {
  shown: Lore;
  folders: LoreFolder[];
  change: (patch: Partial<Lore>, valid?: boolean) => void;
  status: keyof typeof SAVE_STATUS | null;
  remove: () => void;
};

function EntryFields({ shown, folders, change, status, remove }: FieldsProps) {
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
        <SettingRow label="키워드" help="최근 대화에 이 중 하나가 나오면 내용이 들어가요." wide control={<PhraseField label="키워드" phrases={shown.keys} onChange={(keys) => change({ keys })} />} />
        {toggle('selective', '보조 키워드도 맞아야', '키워드 하나와 보조 키워드 하나가 함께 나와야 들어가요.')}
        {shown.selective && (
          <SettingRow label="보조 키워드" wide control={<PhraseField label="보조 키워드" phrases={shown.secondaryKeys} onChange={(secondaryKeys) => change({ secondaryKeys })} />} />
        )}
        {toggle('useRegex', '정규식으로', '키워드를 /패턴/ 또는 /패턴/플래그 꼴의 정규식으로 읽어요.')}
        {toggle('caseSensitive', '대소문자 구분')}
      </SettingGroup>
      <TextField label="내용" lines={8} value={shown.content} onChange={(content) => change({ content })} help="맨 앞에 @@로 시작하는 줄은 넣는 방식을 정하는 명령으로 읽어요. 예: @@depth 0" />
      <SettingGroup label="넣기">
        {toggle('enabled', '켬')}
        {toggle('constant', '항상 넣기', '키워드와 상관없이 늘 들어가요. 로어북 예산을 넘으면 빠질 수 있어요.')}
        <SettingRow
          label="순서"
          help="함께 들어간 항목끼리는 이 값이 큰 것이 뒤에 놓여요."
          error={orderValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="순서" value={order} invalid={!orderValid} onChange={changeOrder} />}
        />
        <SettingRow
          label="우선순위"
          help="로어북 예산이 모자라면 이 값이 큰 것부터 넣어요. 비우면 순서 값을 써요."
          changed={shown.priority !== null}
          error={priorityValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="우선순위" value={priority} placeholder="순서와 같음" invalid={!priorityValid} onChange={changePriority} />}
        />
        <SettingRow
          label="위치"
          help={`${SLOT_NAMES.lorebook} 자리는 프롬프트에서 ${SLOT_NAMES.lorebook}를 넣는 곳이에요. ${SLOT_NAMES.description} 앞·뒤는 그 칸 안에 붙어요.`}
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
          이 항목 지우기
        </Button>
      </Row>
    </Stack>
  );
}
