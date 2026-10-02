import { useState } from 'react';
import { PICTURE_PERCENT, type Character, type Pictures } from '../../model/library';
import { editCharacter, setBotModels, setDecor, setPictures, type CharacterText } from '../../runtime/characters';
import { scriptsOf } from '../../runtime/scripts';
import { aliased } from '../common/alias';
import { EntryList } from '../common/EntryList';
import type { Frame } from '../common/frame';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { BOT_MODELS, BOT_MODELS_HELP } from '../common/words';
import { useStore } from '../session';
import { useToast } from '../toast';
import { Disclosure, NumberInput, Section, SettingGroup, SettingRow, Switch, Text, TextField } from '../ui';

type Height = 'peek' | 'most';
const HEIGHT_ERROR = `${PICTURE_PERCENT.min}에서 ${PICTURE_PERCENT.max} 사이로 적어 주세요.`;
const readHeight = (draft: string) => {
  const value = Number(draft);
  return Number.isInteger(value) && value >= PICTURE_PERCENT.min && value <= PICTURE_PERCENT.max ? value : null;
};
// One status for the editor's two saves: a failure first, then one still saving.
const merged = (...statuses: (keyof typeof SAVE_STATUS | null)[]) =>
  statuses.find((each) => each === 'failed') ?? statuses.find((each) => each === 'saving') ?? statuses.find((each) => each !== null) ?? null;

// 캐릭터 편집: the card's text and the alias, on its own page or beside the chat. Only the fields changed here go to
// editCharacter. A caller leaves by unmounting it, which saves.
export function CharacterEditor({ id, initial, frame }: { id: string; initial: Character; frame: Frame }) {
  const store = useStore();
  const [text, setText] = useState<CharacterText>({ ...initial.card, alias: initial.alias ?? '' });
  const { status, change: queue } = useAutosave<CharacterText>((patch) => editCharacter(store, id, patch));
  const toast = useToast();
  const [decor, setDecorShown] = useState(initial.decor !== false);
  const [botModels, setBotModelsShown] = useState(initial.botModels === true);
  const pictureSave = useAutosave<Pictures>((patch) => setPictures(store, id, patch));
  const [fold, setFold] = useState(initial.pictures?.fold !== false);
  const [heights, setHeights] = useState<Record<Height, string>>({ peek: String(initial.pictures?.peek ?? ''), most: String(initial.pictures?.most ?? '') });

  function changeDecor(on: boolean) {
    setDecorShown(on);
    void setDecor(store, id, on).then((saved) => {
      if (saved.ok) return;
      setDecorShown(!on);
      toast.failed(saved, '저장하지 못했어요.');
    });
  }

  function changeBotModels(on: boolean) {
    setBotModelsShown(on);
    void setBotModels(store, id, on).then((saved) => {
      if (saved.ok) return;
      setBotModelsShown(!on);
      toast.failed(saved, '저장하지 못했어요.');
    });
  }

  function changeFold(on: boolean) {
    setFold(on);
    pictureSave.change({ fold: on ? undefined : false });
  }

  function changeHeight(field: Height, draft: string) {
    setHeights((current) => ({ ...current, [field]: draft }));
    const value = readHeight(draft);
    pictureSave.change({ [field]: value ?? undefined }, draft.trim() === '' || value !== null);
  }

  function heightRow(field: Height, label: string, help: string, placeholder: string) {
    const set = heights[field].trim() !== '';
    const invalid = set && readHeight(heights[field]) === null;
    return (
      <SettingRow
        label={label}
        help={help}
        changed={set}
        error={invalid ? HEIGHT_ERROR : undefined}
        control={<NumberInput label={label} value={heights[field]} unit="%" placeholder={placeholder} invalid={invalid} onChange={(draft) => changeHeight(field, draft)} />}
      />
    );
  }

  function change<K extends keyof CharacterText>(field: K, value: CharacterText[K]) {
    setText((current) => ({ ...current, [field]: value }));
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
          <SettingRow label="봇 꾸밈" help="봇이 만든 상태창, 꾸밈과 버튼을 그려요. 끄면 글만 보여요." control={<Switch label="봇 꾸밈" checked={decor} onChange={changeDecor} />} />
          {decor && (
            <SettingRow
              label="긴 그림 접기"
              help="그림만 있는 줄은 윗부분만 보여요. 마우스를 올려 두거나 누르면 펼쳐져요."
              control={<Switch label="긴 그림 접기" checked={fold} onChange={changeFold} />}
            />
          )}
          {scriptsOf([initial.card]).length > 0 && <SettingRow label={BOT_MODELS} help={BOT_MODELS_HELP} control={<Switch label={BOT_MODELS} checked={botModels} onChange={changeBotModels} />} />}
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
    </>
  );
  const saved = merged(status, pictureSave.status);
  return frame({ head: { title: '캐릭터 편집', subtitle: aliased(text.name, text.alias), status: saved ? SAVE_STATUS[saved] : undefined }, body });
}
