import { setModels } from '../../runtime/pack';
import type { ObjectStore } from '../../runtime/store';
import { BookOpen, Braces, Eye, IdCard, Images, ImageUp, Languages, Link2, MessageSquareQuote, Package, Palette, ScrollText, Square, UserRound, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { storyHtml } from '../../engine/display';
import { unused } from '../../engine/pipeline';
import type { ChatSummary } from '../../model/chat';
import { PICTURE_PERCENT, type CharacterShelf, type Pictures } from '../../model/library';
import { likenessId } from '../../model/likeness';
import { editCharacter, setAvatar, setDecor, setKeepThoughts, setPictures, setTranslatorNote, type CharacterText } from '../../runtime/characters';
import { scriptsOf } from '../../runtime/scripts';
import { packsOf } from '../../runtime/chat-context';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { describeTranslateFailure } from '../common/failure';
import { describeUnused } from '../common/unused';
import { AssetsEditor } from '../common/AssetsEditor';
import { EntryList } from '../common/EntryList';
import { LoreEditor } from '../common/LoreEditor';
import { scriptHolds } from '../common/pack';
import { ModuleSwitches } from '../common/ModuleSwitches';
import { ScriptsEditor } from '../common/ScriptsEditor';
import { PortraitsEditor } from '../common/PortraitsEditor';
import type { CharacterPart } from '../common/characterPart';
import type { Frame } from '../common/frame';
import { filled, typedText } from '../common/typed';
import { readOptional } from '../common/typedNumber';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { BOT_MODELS, BOT_MODELS_HELP, CHANGE_IMAGE, inSettings, NOTE_PLACEHOLDER, PAGES, SCRIPTS, SHARE, STOP, TRANSLATOR_NOTE } from '../common/words';
import { ShareDialog } from './ShareDialog';
import { useCharacter, useChildren, useFiles, useModules, useSettings, useStore, useStored } from '../session';
import { navigate } from '../shell/router';
import { characterPage, HOME } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Disclosure, FaceRow, FileButton, List, ListItem, MenuItem, NavGroup, NavRow, NumberInput, Portrait, Row, Section, SettingGroup, SettingRow, Story, Switch, Tag, Text, TextField, useWide } from '../ui';
import { useCardTranslation } from './useCardTranslation';
import { useCharacterActions } from './useCharacterActions';

type Height = 'peek' | 'most';
const HEIGHT_ERROR = `${PICTURE_PERCENT.min}에서 ${PICTURE_PERCENT.max} 사이로 입력해 주세요.`;
// undefined: left empty, which is the app's own height. null: not a height.
const readHeight = (draft: string) => {
  const value = readOptional(draft, true);
  return typeof value === 'number' && (value < PICTURE_PERCENT.min || value > PICTURE_PERCENT.max) ? null : value;
};
const SWITCHES = { decor: setDecor, botModels: (store: ObjectStore, id: string, on: boolean) => setModels(store, { kind: 'character', id }, on), keepThoughts: setKeepThoughts };
type Switched = keyof typeof SWITCHES;
const merged = (...statuses: (keyof typeof SAVE_STATUS | null)[]) =>
  statuses.find((each) => each === 'failed') ?? statuses.find((each) => each === 'saving') ?? statuses.find((each) => each !== null) ?? null;

const PARTS: Record<CharacterPart, { label: string; icon: LucideIcon }> = {
  profile: { label: '프로필', icon: IdCard },
  character: { label: '캐릭터', icon: UserRound },
  greetings: { label: '첫인사', icon: MessageSquareQuote },
  instructions: { label: '지시문', icon: ScrollText },
  lore: { label: '로어북', icon: BookOpen },
  modules: { label: PAGES.modules, icon: Package },
  scripts: { label: SCRIPTS.part, icon: Braces },
  assets: { label: '에셋', icon: Images },
  illustration: { label: '삽화', icon: Palette },
  display: { label: '표시', icon: Eye },
};
const GROUPS: CharacterPart[][] = [
  ['profile', 'character', 'greetings'],
  ['instructions', 'lore', 'modules', 'scripts'],
  ['assets', 'illustration', 'display'],
];
const LIST = '캐릭터 항목';
type Reading = 'source' | 'translated';
const READINGS: { value: Reading; label: string }[] = [
  { value: 'source', label: '원문' },
  { value: 'translated', label: '번역' },
];

type Props = {
  shelf: CharacterShelf<ChatSummary>;
  // The caller decides, since a side panel is narrow on any screen.
  layout: 'split' | 'drill';
  part: CharacterPart | null;
  onPart: (part: CharacterPart | null) => void;
  frame: Frame;
};

// The character's one screen: beside its chat, or a page elsewhere. Only the fields changed here go to editCharacter.
// A caller leaves by unmounting it, which saves; moving between parts keeps it mounted, so nothing typed is lost.
// shelf: the stored character as it is now, on every render. The editor shows it, under what waits to be saved.
export function CharacterEditor({ shelf, layout, part, onPart, frame }: Props) {
  const { id, character, face } = shelf;
  const { card, origin } = character;
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const wide = useWide();
  const original = useCharacter(origin?.id ?? null);
  const lore = useChildren('lore', id);
  const assets = useChildren('asset', id);
  const likeness = useStored('likeness', likenessId(id));
  const modules = useModules();
  const always = useSettings().modules ?? [];
  const ownModules = character.modules ?? [];
  const { busy, copy, exportFile, remove, sharing, share, stopSharing } = useCharacterActions();
  const { status, unsaved, change: queue } = useAutosave<CharacterText>(`character:${id}`, (patch) => editCharacter(store, id, patch));
  const pictureSave = useAutosave<Pictures>(`character-pictures:${id}`, (patch) => setPictures(store, id, patch));
  const noteSave = useAutosave<{ note: string }>(`character-note:${id}`, ({ note = '' }) => setTranslatorNote(store, id, note));
  const [typedName, setTypedName] = useState<string>();
  const [changingFace, setChangingFace] = useState(false);
  const [typedHeights, setTypedHeights] = useState<Partial<Record<Height, string>>>({});
  const held: CharacterText = { ...character.card, alias: character.alias ?? '', ...unsaved };
  const text = { ...held, name: typedText(typedName, filled, held.name, String) };
  // Most cards leave these two empty. Fixed at mount, so clearing one while typing does not hide it.
  const [legacy] = useState(() => ({ personality: !!held.personality, scenario: !!held.scenario }));
  const translation = useCardTranslation(id, character);
  const [reading, setReading] = useState<Reading>('source');
  const translated = reading === 'translated';
  const pictures: Pictures = { ...character.pictures, ...pictureSave.unsaved };
  const fold = pictures.fold !== false;
  const decor = character.decor !== false;
  const botModels = character.botModels === true;
  const keepThoughts = character.keepThoughts === true;

  async function changeFace(file: File) {
    setChangingFace(true);
    const changed = await setAvatar(store, files, id, new Uint8Array(await file.arrayBuffer()));
    setChangingFace(false);
    if (!changed.ok) toast.failed(changed, '이미지를 바꾸지 못했어요.');
  }

  function flip(field: Switched, on: boolean) {
    void SWITCHES[field](store, id, on).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  function changeHeight(field: Height, draft: string) {
    setTypedHeights((current) => ({ ...current, [field]: draft }));
    const value = readHeight(draft);
    pictureSave.change({ [field]: value ?? undefined }, value !== null);
  }

  function heightRow(field: Height, label: string, help: string, placeholder: string) {
    const height = typedText(typedHeights[field], readHeight, pictures[field], (value) => String(value ?? ''));
    const set = height.trim() !== '';
    const invalid = readHeight(height) === null;
    return (
      <SettingRow
        label={label}
        help={help}
        changed={set}
        error={invalid ? HEIGHT_ERROR : undefined}
        control={<NumberInput label={label} value={height} unit="%" placeholder={placeholder} invalid={invalid} onChange={(draft) => changeHeight(field, draft)} />}
      />
    );
  }

  function change<K extends keyof CharacterText>(field: K, value: CharacterText[K]) {
    if (field === 'name') setTypedName(value as string);
    queue({ [field]: value }, field !== 'name' || !!(value as string).trim());
  }

  const readingSwitch = (
    <Row kind="toolbar">
      {translated &&
        (translation.running.size > 0 ? (
          <Button variant="secondary" icon={Square} onClick={translation.stop}>
            {STOP}
          </Button>
        ) : (
          <Button variant="ghost" icon={Languages} disabled={!translation.translator.ok || translation.sources.length === 0} onClick={translation.start}>
            {translation.missing.length > 0 ? '번역하기' : '다시 번역'}
          </Button>
        ))}
      <ChoiceGroup layout="segmented" label="보기" options={READINGS} value={reading} onChange={setReading} />
    </Row>
  );
  const untranslated = (source: string) => (translation.running.has(source) ? '번역 중…' : '아직 번역하지 않았어요.');
  const translatorMissing = translated && !translation.translator.ok && <Callout tone="warn">{`번역할 수 없어요. ${describeTranslateFailure(translation.translator.failure)}`}</Callout>;
  // The stored card's text, as it was translated; a draft not saved yet is not.
  const translatedField = (label: string, source: string, lines: number) =>
    source.trim() && (
      <TextField
        key={label}
        label={label}
        lines={lines}
        readOnly
        value={translation.translationOf(source) ?? ''}
        placeholder={untranslated(source)}
        onChange={() => {}}
      />
    );

  const notUsed = describeUnused(unused(card));
  const notesTranslated = translation.translationOf(card.creatorNotes);
  const split = layout === 'split';
  const lead = (
    <>
      {origin && (
        <Row kind="actions">
          <Text variant="note">
            '{origin.name}'에서 만든 사본{original ? '' : ' (원본 삭제됨)'}
          </Text>
          {original && (
            <Button variant="ghost" size="sm" onClick={() => navigate(characterPage(origin.id, wide))}>
              원본 보기
            </Button>
          )}
        </Row>
      )}
      {card.tags.length > 0 && (
        <Row kind="tags">
          {card.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Row>
      )}
      {notUsed && <Callout tone="warn">{notUsed}</Callout>}
    </>
  );
  const pages: Record<CharacterPart, ReactNode> = {
    profile: (
      <>
        <FaceRow face={<Portrait image={face} name={card.name} />}>
          <FileButton accept="image/*" size="sm" icon={ImageUp} busy={changingFace} onFiles={([file]) => void changeFace(file!)}>
            {CHANGE_IMAGE}
          </FileButton>
        </FaceRow>
        {split && lead}
        <Section title={PARTS.profile.label}>
          <TextField label="이름" value={text.name} onChange={(value) => change('name', value)} error={text.name.trim() ? undefined : '이름을 입력해 주세요.'} />
          <TextField label="별명" value={text.alias} onChange={(value) => change('alias', value)} placeholder="예: 겨울 버전" help="나만 보는 이름이에요." />
          <TextField
            label="부르는 이름"
            value={text.nickname ?? ''}
            onChange={(value) => change('nickname', value === '' ? null : value)}
            help="채팅에서 {{char}} 자리에 이름 대신 들어가요."
          />
        </Section>
        {card.creatorNotes.trim() && (
          <Section title="소개" action={readingSwitch}>
            {translatorMissing}
            {!translated ? (
              <Story html={storyHtml(card.creatorNotes, true)} />
            ) : notesTranslated !== undefined ? (
              <Story html={storyHtml(notesTranslated, true)} />
            ) : (
              <Text variant="note">{untranslated(card.creatorNotes)}</Text>
            )}
          </Section>
        )}
      </>
    ),
    character: (
      <Section title={PARTS.character.label} action={readingSwitch}>
        {translatorMissing}
        {translated ? (
          <>
            {translatedField('설명', card.description, 20)}
            {translatedField('성격', card.personality, 4)}
            {translatedField('상황', card.scenario, 4)}
            {translatedField('예시 대화', card.exampleDialogue, 6)}
          </>
        ) : (
          <>
            <TextField label="설명" lines={20} value={text.description} onChange={(value) => change('description', value)} />
            {legacy.personality && <TextField label="성격" lines={4} value={text.personality} onChange={(value) => change('personality', value)} />}
            {legacy.scenario && <TextField label="상황" lines={4} value={text.scenario} onChange={(value) => change('scenario', value)} />}
            <TextField label="예시 대화" lines={6} value={text.exampleDialogue} onChange={(value) => change('exampleDialogue', value)} />
          </>
        )}
      </Section>
    ),
    greetings: (
      <Section title={PARTS.greetings.label} help="새 채팅을 열 때 이 중에서 선택할 수 있어요." action={readingSwitch}>
        {translatorMissing}
        {translated ? (
          card.greetings.map((greeting, index) => translatedField(`첫인사 ${index + 1}`, greeting, 6))
        ) : (
          <EntryList
            entries={text.greetings}
            onChange={(greetings) => change('greetings', greetings)}
            name={(index) => `첫인사 ${index + 1}`}
            blank=""
            addLabel="첫인사 추가"
            removed={(index) => `${index + 1}번째 첫인사를 삭제했어요.`}
          >
            {({ value, name, set, remove }) => <TextField label={name} lines={6} value={value} onChange={set} action={remove} />}
          </EntryList>
        )}
      </Section>
    ),
    instructions: (
      <Section title={PARTS.instructions.label}>
        <TextField
          label="시스템 프롬프트"
          lines={6}
          value={text.systemPrompt}
          onChange={(value) => change('systemPrompt', value)}
          help="비우면 기본 지시문을 써요. {{original}}을 넣으면 그 자리에 기본 지시문이 들어가요."
        />
        <TextField
          label="대화 뒤 지시문"
          lines={4}
          value={text.postHistoryInstructions}
          onChange={(value) => change('postHistoryInstructions', value)}
          help="대화 기록 바로 뒤에 붙어요."
        />
        <SettingRow
          label="유틸리티 봇"
          help="프롬프트는 쓰지 않고 이 캐릭터의 지시문, 설명, 로어북, 대화만 보내요. 번역기처럼 역할극이 아닌 봇에 맞아요."
          control={<Switch label="유틸리티 봇" checked={text.utility} onChange={(on) => change('utility', on)} />}
        />
        <TextField
          label={TRANSLATOR_NOTE}
          lines={6}
          value={noteSave.unsaved.note ?? character.translatorNote ?? ''}
          onChange={(note) => noteSave.change({ note })}
          placeholder={NOTE_PLACEHOLDER}
          help={`이 캐릭터의 번역에만 들어가요. 전역 노트는 ${inSettings('chat')}에 있어요.`}
        />
      </Section>
    ),
    lore: <LoreEditor owner={{ kind: 'character', id }} folders={character.loreFolders} />,
    modules: <ModuleSwitches owner={{ kind: 'character', id }} own={ownModules} />,
    scripts: <ScriptsEditor owner={{ kind: 'character', id }} pack={card} drill={!split} status={character.statusScripts} />,
    assets: <AssetsEditor owner={id} />,
    illustration: <PortraitsEditor owner={id} />,
    display: (
      <Section title={PARTS.display.label}>
        <SettingGroup label={PARTS.display.label}>
          <SettingRow label="봇 스타일" help="봇이 만든 상태창, 스타일, 버튼을 표시해요." control={<Switch label="봇 스타일" checked={decor} onChange={(on) => flip('decor', on)} />} />
          {decor && (
            <SettingRow
              label="긴 이미지 접기"
              help="이미지만 있는 줄은 윗부분만 보여요."
              control={<Switch label="긴 이미지 접기" checked={fold} onChange={(on) => pictureSave.change({ fold: on ? undefined : false })} />}
            />
          )}
          <SettingRow
            label="추론을 본문에 표시"
            help="<Thoughts> 같은 추론 블록을 숨기지 않고 본문에 보여 줘요."
            control={<Switch label="추론을 본문에 표시" checked={keepThoughts} onChange={(on) => flip('keepThoughts', on)} />}
          />
          {scriptsOf(packsOf(store, { character: id })).length > 0 && <SettingRow label={BOT_MODELS} help={BOT_MODELS_HELP} control={<Switch label={BOT_MODELS} checked={botModels} onChange={(on) => flip('botModels', on)} />} />}
        </SettingGroup>
        {decor && (
          <Disclosure label="이미지 크기">
            <SettingGroup label="이미지 크기">
              {fold && heightRow('peek', '접힌 높이', '화면 높이 대비 비율이에요.', '40')}
              {heightRow('most', '최대 높이', '화면 높이 대비 비율이에요.', '원래 크기')}
            </SettingGroup>
          </Disclosure>
        )}
      </Section>
    ),
  };
  const holds: Partial<Record<CharacterPart, string>> = {
    greetings: `${text.greetings.length}개`,
    lore: `${lore.length}개`,
    modules: `${modules.filter((module) => always.includes(module.id) || ownModules.includes(module.id)).length}개 켜짐`,
    scripts: scriptHolds(card) || undefined,
    assets: `${assets.length}개`,
    illustration: likeness ? `${likeness.value.portraits.length}명` : undefined,
  };
  // A part with nothing to show is left out: 모듈 lists the account's modules, and there may be none.
  const groups = GROUPS.map((group) => group.filter((each) => each !== 'modules' || modules.length > 0));
  const saved = merged(status, pictureSave.status, noteSave.status);
  const subtitle = card.creator ? `제작자 ${card.creator}` : undefined;
  const working = busy?.id === id ? busy.label : null;
  const menu = {
    of: '캐릭터',
    items: (
      <>
        <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} disabled={busy !== null} onClick={() => void copy(shelf)} />
        <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} disabled={busy !== null} onClick={() => exportFile(shelf)} />
        <MenuItem icon={Link2} label={SHARE.act} disabled={busy !== null} onClick={() => share(shelf)} />
        <MenuItem
          icon={ACTS.remove.icon}
          label={ACTS.remove.label}
          tone="warn"
          disabled={busy !== null}
          onClick={() => {
            remove(shelf);
            navigate(HOME);
          }}
        />
      </>
    ),
  };
  const title = aliased(text.name, text.alias);
  const shareDialog = sharing && <ShareDialog character={id} name={text.name} onClose={stopSharing} />;
  const state = working ?? (saved ? SAVE_STATUS[saved] : undefined);
  if (split) {
    const open = part ?? 'profile';
    const side = groups.map((group) => (
      <NavGroup key={group[0]}>
        {group.map((each) => (
          <NavRow key={each} icon={PARTS[each].icon} label={PARTS[each].label} meta={holds[each]} current={each === open} onClick={() => onPart(each)} />
        ))}
      </NavGroup>
    ));
    return frame({ head: { title, subtitle, status: state, menu }, side, body: <>{pages[open]}{shareDialog}</>, open });
  }
  if (part) return frame({ head: { title, onBack: () => onPart(null), backLabel: LIST, status: state }, body: pages[part], open: part });
  const list = (
    <>
      {lead}
      {groups.map((group) => (
        <NavGroup key={group[0]}>
          <List box places label={group.map((each) => PARTS[each].label).join(', ')}>
            {group.map((each) => (
              <ListItem key={each} title={PARTS[each].label} aside={holds[each]} onClick={() => onPart(each)} />
            ))}
          </List>
        </NavGroup>
      ))}
    </>
  );
  return frame({ head: { title, subtitle, status: state, menu }, body: <>{list}{shareDialog}</>, open: LIST });
}
