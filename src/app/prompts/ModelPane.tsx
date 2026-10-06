import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AUX_HELP, DEFAULT_MODELS, follows, inSettings, MODEL_ROLES, NOT_STARRED } from '../common/words';
import { Section, SettingGroup } from '../ui';

const DEFAULTS = follows(DEFAULT_MODELS);
const AUX = follows(MODEL_ROLES.aux);
const TUNING = `온도 같은 값은 ${inSettings('models')}에서 정해요.`;

type Task = Exclude<PromptSort, 'conversation'>;

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? NOT_STARRED;

export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULTS;
  return models.aux ? `${main} · ${MODEL_ROLES.aux} 별도 지정` : main;
}

export const taskModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, 보조 모델 takes 기본 모델's own 보조 모델 first, and only then 대화 모델.
  const follow = (role: Role) => (role === 'main' || defaults.aux ? DEFAULTS : follows(MODEL_ROLES.main));
  const picker = (role: Role, help?: string) => <RolePicker role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <Section title="모델" hint={TUNING}>
      <SettingGroup label="모델">
        {picker('main')}
        {picker('aux', AUX_HELP)}
      </SettingGroup>
    </Section>
  );
}

const TASK_LABELS = { translate: '번역 모델', memory: '기억 모델' } satisfies Record<Task, string>;

type TaskProps = { task: Task; own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void };

// A task prompt's own model, the one place its task's model is chosen.
export function TaskModelPane({ task, own, connections, onPick }: TaskProps) {
  return (
    <Section title="모델" hint={TUNING}>
      <SettingGroup label="모델">
        <RolePicker role="aux" label={TASK_LABELS[task]} own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
