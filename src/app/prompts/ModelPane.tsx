import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AUX_HELP, DEFAULT_MODELS, follows, inSettings, MODEL_ROLES, NOT_STARRED } from '../common/words';
import { Section, SettingGroup } from '../ui';

const DEFAULTS = follows(DEFAULT_MODELS);
const AUX = follows(MODEL_ROLES.aux);

type Task = Exclude<PromptSort, 'conversation'>;

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? NOT_STARRED;

export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULTS;
  return models.aux ? `${main} · ${MODEL_ROLES.aux} 따로` : main;
}

export const taskModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, 보조 모델 takes 기본 모델's own 보조 모델 first, and only then 대화 모델.
  const follow = (role: Role) => (role === 'main' || defaults.aux ? DEFAULTS : follows(MODEL_ROLES.main));
  const picker = (role: Role, help?: string) => <RolePicker role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <Section title="모델" hint={`이 프롬프트로 여는 채팅이 쓰는 모델이에요. 채팅에서 모델을 바꾸면 그 채팅만 바뀌어요. 온도 같은 값은 ${inSettings('models')}에서 정해요.`}>
      <SettingGroup label="모델">
        {picker('main')}
        {picker('aux', AUX_HELP)}
      </SettingGroup>
    </Section>
  );
}

const TASK_WORDS = {
  translate: { label: '번역 모델', hint: '이 번역 프롬프트로 번역할 때 쓰는 모델이에요.' },
  memory: { label: '기억 모델', hint: `이 기억 프롬프트로 장기 기억을 정리할 때 쓰는 모델이에요. 정하지 않으면 채팅의 ${MODEL_ROLES.aux}, 그것도 없으면 ${MODEL_ROLES.main}을 써요.` },
} satisfies Record<Task, { label: string; hint: string }>;

type TaskProps = { task: Task; own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void };

// A task prompt's own model, the one place its task's model is chosen.
export function TaskModelPane({ task, own, connections, onPick }: TaskProps) {
  const { label, hint } = TASK_WORDS[task];
  return (
    <Section title="모델" hint={`${hint} 온도 같은 값은 ${inSettings('models')}에서 정해요.`}>
      <SettingGroup label="모델">
        <RolePicker role="aux" label={label} own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
