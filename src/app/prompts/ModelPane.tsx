import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AUX_HELP, DEFAULT_MODELS, follows, inSettings, MODEL_ROLES, MODEL_SETTINGS, NOT_STARRED, opens, PRE_READ } from '../common/words';
import { navigate } from '../shell/router';
import { Section, SettingGroup, type Help } from '../ui';

const DEFAULTS = follows(DEFAULT_MODELS);
const AUX = follows(MODEL_ROLES.aux);

type Task = Exclude<PromptSort, 'conversation'>;

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? NOT_STARRED;

export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULTS;
  return models.aux ? `${main} · ${MODEL_ROLES.aux} 별도 지정` : main;
}

export const taskModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

function tuning(picked: ModelRef | undefined, connections: readonly Stored<'connection'>[]): Help {
  const model = picked && findStarred(picked, connections);
  return {
    text: `온도 같은 값은 ${MODEL_SETTINGS}에서 정해요.`,
    open: model ? { label: opens(model.name), onClick: () => navigate({ kind: 'model', ...picked }) } : { label: opens(inSettings('models')), onClick: () => navigate({ kind: 'models' }) },
  };
}

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, 보조 모델 takes 기본 모델's own 보조 모델 first, and only then 대화 모델.
  const follow = (role: Role) => (role === 'main' || defaults.aux ? DEFAULTS : follows(MODEL_ROLES.main));
  const picker = (role: Role, help?: string) => <RolePicker role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <Section title="모델" help={tuning(models.main, connections)}>
      <SettingGroup label="모델">
        {picker('main')}
        {picker('aux', AUX_HELP)}
      </SettingGroup>
    </Section>
  );
}

const TASK_LABELS = { translate: '번역 모델', memory: '기억 모델', illustrate: '장면 모델', mascot: '대사 모델', preread: `${PRE_READ} 모델` } satisfies Record<Task, string>;

type TaskProps = { task: Task; own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void };

// A task prompt's own model, the one place its task's model is chosen.
export function TaskModelPane({ task, own, connections, onPick }: TaskProps) {
  return (
    <Section title="모델" help={tuning(own, connections)}>
      <SettingGroup label="모델">
        <RolePicker role="aux" label={TASK_LABELS[task]} own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
