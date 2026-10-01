import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AUX_HELP, DEFAULT_MODELS, follows, inSettings, MODEL_ROLES, NOT_STARRED } from '../common/words';
import { Section, SettingGroup } from '../ui';

const DEFAULTS = follows(DEFAULT_MODELS);
const AUX = follows(MODEL_ROLES.aux);

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? NOT_STARRED;

// What the 모델 row says: a conversation prompt's 대화 모델 and whether it sets its own 보조 모델.
export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULTS;
  return models.aux ? `${main} · ${MODEL_ROLES.aux} 따로` : main;
}

export const taskModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

// A conversation prompt's layer of the model assignment.
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

// A translation prompt's own model, the one place a translation's model is chosen.
export function TaskModelPane({ own, connections, onPick }: { own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void }) {
  return (
    <Section title="모델" hint={`이 번역 프롬프트로 번역할 때 쓰는 모델이에요. 온도 같은 값은 ${inSettings('models')}에서 정해요.`}>
      <SettingGroup label="모델">
        <RolePicker role="aux" label="번역 모델" own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
