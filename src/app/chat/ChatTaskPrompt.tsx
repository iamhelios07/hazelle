import { ofSort, translationPrompt, illustrationPrompt } from '../../runtime/prompts';
import { defaultMark, DELETED_PROMPT, follows } from '../common/words';
import { useSession, useSettings, usePrompts } from '../session';
import { ChipButton, Divider, Menu, MenuHeading, MenuItem, SettingRow, Switch, Tag } from '../ui';
type NamedCharacter = { name: string } | null;

export const appliesTo = (card: NamedCharacter, own: boolean) => (card && own ? `${card.name}의 채팅에만 적용돼요.` : '캐릭터별 설정이 없는 모든 채팅에 적용돼요.');

export function PerCharacter({ card, own, onChange }: { card: NamedCharacter; own: boolean; onChange: (own: boolean) => void }) {
  return (
    card && (
      <SettingRow
        label="캐릭터별 설정"
        help={`켜면 ${card.name}의 채팅에만 이 설정을 적용해요.`}
        control={<Switch label="캐릭터별 설정" checked={own} onChange={onChange} />}
      />
    )
  );
}

const TASKS = {
  translate: { noun: '번역', setting: 'translatePrompt', choose: translationPrompt },
  illustrate: { noun: '삽화', setting: 'illustratePrompt', choose: illustrationPrompt },
} as const;

// Without its own choice the switches follow the task's default prompt live, and a deleted one shows as missing, never
// as another prompt.
export function TaskPromptMenu({ task, chosen, heading, onPick, onEdit }: { task: keyof typeof TASKS; chosen: string | undefined; heading: string; onPick: (prompt: string | undefined) => void; onEdit: (id: string | null) => void }) {
  const { noun, setting, choose } = TASKS[task];
  const { store } = useSession();
  const settings = useSettings();
  const prompts = usePrompts()
    .filter((each) => ofSort(each, task))
    .sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));
  const choice = choose(store, chosen);
  const fallback = prompts.find(({ id }) => id === settings[setting]);
  const missing = `기본 ${noun} 프롬프트 없음`;
  const label = choice.kind === 'prompt' ? choice.prompt.value.name : choice.own ? DELETED_PROMPT : missing;
  return (
    <Menu
      place="above-end"
      label={`${noun} 프롬프트`}
      trigger={(opener) => <ChipButton variant="field" opens="up" label={label} title={`${noun} 프롬프트`} tone={choice.kind === 'missing' ? 'warn' : 'default'} {...opener} />}
    >
      <MenuHeading>{heading}</MenuHeading>
      <MenuItem label={follows(`기본 ${noun} 프롬프트`)} sub={fallback?.value.name ?? missing} checked={chosen === undefined} onClick={() => onPick(undefined)} />
      {prompts.map((item) => {
        const mark = defaultMark(item.id === settings[setting], item.value.name);
        return <MenuItem key={item.id} label={item.value.name} tag={mark && <Tag tone="accent">{mark}</Tag>} checked={item.id === chosen} onClick={() => onPick(item.id)} />;
      })}
      <Divider variant="menu" />
      {choice.kind === 'prompt' && <MenuItem label="이 프롬프트 편집…" onClick={() => onEdit(choice.prompt.id)} />}
      <MenuItem label="프롬프트 관리…" onClick={() => onEdit(null)} />
    </Menu>
  );
}
