import { useState } from 'react';
import { PICTURE_PERCENT, type Character, type Pictures } from '../../model/library';
import { editCharacter, setBotModels, setDecor, setKeepThoughts, setPictures, type CharacterText } from '../../runtime/characters';
import { setCharacterModule } from '../../runtime/modules';
import { scriptsOf } from '../../runtime/scripts';
import { packsOf } from '../../runtime/turn';
import { aliased } from '../common/alias';
import { EntryList } from '../common/EntryList';
import type { Frame } from '../common/frame';
import { filled, typedText } from '../common/typed';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { ALWAYS, BOT_MODELS, BOT_MODELS_HELP, inSettings, moduleName, PAGES } from '../common/words';
import { useModules, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Disclosure, NumberInput, Section, SettingGroup, SettingRow, Switch, Text, TextField } from '../ui';

type Height = 'peek' | 'most';
const HEIGHT_ERROR = `${PICTURE_PERCENT.min}에서 ${PICTURE_PERCENT.max} 사이로 적어 주세요.`;
// undefined: left empty, which is the app's own height. null: not a height.
const readHeight = (draft: string) => {
  if (draft.trim() === '') return undefined;
  const value = Number(draft);
  return Number.isInteger(value) && value >= PICTURE_PERCENT.min && value <= PICTURE_PERCENT.max ? value : null;
};
const SWITCHES = { decor: setDecor, botModels: setBotModels, keepThoughts: setKeepThoughts };
type Switched = keyof typeof SWITCHES;
// One status for the editor's two saves: a failure first, then one still saving.
const merged = (...statuses: (keyof typeof SAVE_STATUS | null)[]) =>
  statuses.find((each) => each === 'failed') ?? statuses.find((each) => each === 'saving') ?? statuses.find((each) => each !== null) ?? null;

// 캐릭터 편집: the card's text and the alias, on its own page or beside the chat. Only the fields changed here go to
// editCharacter. A caller leaves by unmounting it, which saves.
// character: the stored character as it is now, on every render. The editor shows it, under what waits to be saved.
export function CharacterEditor({ id, character, frame }: { id: string; character: Character; frame: Frame }) {
  const store = useStore();
  const toast = useToast();
  const { status, unsaved, change: queue } = useAutosave<CharacterText>(`character:${id}`, (patch) => editCharacter(store, id, patch));
  const pictureSave = useAutosave<Pictures>(`character-pictures:${id}`, (patch) => setPictures(store, id, patch));
  const [typedName, setTypedName] = useState<string>();
  const [typedHeights, setTypedHeights] = useState<Partial<Record<Height, string>>>({});
  // A switch shows its new value while its save is on its way, and the stored one again if that fails.
  const [switching, setSwitching] = useState<Partial<Record<Switched, boolean>>>({});
  const held: CharacterText = { ...character.card, alias: character.alias ?? '', ...unsaved };
  const text = { ...held, name: typedText(typedName, filled, held.name, String) };
  const pictures: Pictures = { ...character.pictures, ...pictureSave.unsaved };
  const fold = pictures.fold !== false;
  const decor = switching.decor ?? character.decor !== false;
  const botModels = switching.botModels ?? character.botModels === true;
  const keepThoughts = switching.keepThoughts ?? character.keepThoughts === true;
  const modules = useModules();
  const always = useSettings().modules ?? [];
  const own = character.modules ?? [];

  function flip(field: Switched, on: boolean) {
    setSwitching((current) => ({ ...current, [field]: on }));
    void SWITCHES[field](store, id, on).then((saved) => {
      setSwitching((current) => ({ ...current, [field]: undefined }));
      if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
    });
  }

  async function changeModule(module: string, on: boolean) {
    const saved = await setCharacterModule(store, id, module, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
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

  const body = (
    <>
      <Text variant="note">로어북과 정규식은 아직 여기서 고칠 수 없어요.</Text>
      <Section title="기본 정보">
        <TextField label="이름" value={text.name} onChange={(value) => change('name', value)} error={text.name.trim() ? undefined : '이름을 적어 주세요.'} />
        <TextField label="별명" value={text.alias} onChange={(value) => change('alias', value)} placeholder="예: 겨울 버전" help="나만 보는 이름이에요. 모델에게는 보내지 않아요." />
        <TextField
          label="부르는 이름"
          value={text.nickname ?? ''}
          onChange={(value) => change('nickname', value === '' ? null : value)}
          help="채팅에서 {{char}} 자리에 이름 대신 들어가요. 비우면 이름을 써요."
        />
      </Section>
      <Section title="캐릭터">
        <TextField label="설명" lines={10} value={text.description} onChange={(value) => change('description', value)} />
        <TextField label="성격" lines={4} value={text.personality} onChange={(value) => change('personality', value)} />
        <TextField label="상황" lines={4} value={text.scenario} onChange={(value) => change('scenario', value)} />
        <TextField label="예시 대화" lines={6} value={text.exampleDialogue} onChange={(value) => change('exampleDialogue', value)} />
      </Section>
      <Section title="첫인사" hint="새 채팅을 열면 이 중에서 고를 수 있어요. 이미 시작한 채팅의 첫인사는 바뀌지 않아요.">
        <EntryList
          entries={text.greetings}
          onChange={(greetings) => change('greetings', greetings)}
          name={(index) => `첫인사 ${index + 1}`}
          blank=""
          addLabel="첫인사 추가"
          removed={(index) => `${index + 1}번째 첫인사를 지웠어요.`}
        >
          {({ value, name, set, remove }) => <TextField label={name} lines={6} value={value} onChange={set} action={remove} />}
        </EntryList>
      </Section>
      <Section title="지시문">
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
      </Section>
      <Section title="표시">
        <SettingGroup label="표시">
          <SettingRow label="봇 꾸밈" help="봇이 만든 상태창, 꾸밈과 버튼을 그려요. 끄면 글만 보여요." control={<Switch label="봇 꾸밈" checked={decor} onChange={(on) => flip('decor', on)} />} />
          {decor && (
            <SettingRow
              label="긴 그림 접기"
              help="그림만 있는 줄은 윗부분만 보여요. 마우스를 올려 두거나 누르면 펼쳐져요."
              control={<Switch label="긴 그림 접기" checked={fold} onChange={(on) => pictureSave.change({ fold: on ? undefined : false })} />}
            />
          )}
          <SettingRow
            label="생각을 본문에 둠"
            help="일부 봇은 <Thoughts> 같은 생각 글을 직접 꾸며서 보여 줘요. 켜면 떼어 내지 않고 본문에 그대로 둬요."
            control={<Switch label="생각을 본문에 둠" checked={keepThoughts} onChange={(on) => flip('keepThoughts', on)} />}
          />
          {scriptsOf(packsOf(store, { character: id }).map(({ pack }) => pack)).length > 0 && <SettingRow label={BOT_MODELS} help={BOT_MODELS_HELP} control={<Switch label={BOT_MODELS} checked={botModels} onChange={(on) => flip('botModels', on)} />} />}
        </SettingGroup>
        {decor && (
          <Disclosure label="그림 크기">
            <SettingGroup label="그림 크기">
              {fold && heightRow('peek', '접힌 높이', '화면 높이에 대한 비율이에요.', '40')}
              {heightRow('most', '최대 높이', '화면 높이에 대한 비율이에요. 이보다 큰 그림은 줄여서 다 보여 줘요.', '원래 크기')}
            </SettingGroup>
          </Disclosure>
        )}
      </Section>
      {modules.length > 0 && (
        <Section title={PAGES.modules} hint={`켠 모듈은 이 캐릭터의 모든 채팅에서 일해요. ${inSettings('modules')}에서 ${ALWAYS} 켠 모듈은 여기서 끌 수 없어요.`}>
          <SettingGroup label={PAGES.modules}>
            {modules.map(({ id: module, value }) => (
              <SettingRow
                key={module}
                label={moduleName(value.name)}
                control={
                  always.includes(module) ? (
                    <Text variant="note">{ALWAYS} 켜짐</Text>
                  ) : (
                    <Switch label={moduleName(value.name)} checked={own.includes(module)} onChange={(on) => void changeModule(module, on)} />
                  )
                }
              />
            ))}
          </SettingGroup>
        </Section>
      )}
    </>
  );
  const saved = merged(status, pictureSave.status);
  return frame({ head: { title: '캐릭터 편집', subtitle: aliased(text.name, text.alias), status: saved ? SAVE_STATUS[saved] : undefined }, body });
}
