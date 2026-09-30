import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { findStarred, GONE, RolePicker } from '../common/RolePicker';
import { Section, SettingGroup } from '../ui';

const DEFAULT = '전체 기본값 따르기';
const AUX = '보조 모델과 같게';

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? GONE;

// What the 모델 row says: a conversation prompt's 본 대화 and whether it sets its own 보조.
export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULT;
  return models.aux ? `${main} · 보조 따로` : main;
}

export const taskModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

// A conversation prompt's layer of the model assignment.
export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, 보조 takes 전체 기본값's own 보조 first, and only then 본 대화.
  const follow = (role: Role) => (role === 'main' || defaults.aux ? DEFAULT : '본 대화와 같게');
  const picker = (role: Role, help?: string) => <RolePicker role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <Section title="모델" hint="이 프롬프트로 여는 채팅이 쓰는 모델이에요. 채팅에서 모델을 바꾸면 그 채팅만 바뀌어요. 온도 같은 값은 설정 › 모델 설정에서 정해요.">
      <SettingGroup label="모델">
        {picker('main')}
        {picker('aux', '번역처럼 대화 밖에서 하는 일에 써요. 번역 프롬프트에서 모델을 고르면 번역은 그 모델로 해요.')}
      </SettingGroup>
    </Section>
  );
}

// A translation prompt's own model, the one place a translation's model is chosen.
export function TaskModelPane({ own, connections, onPick }: { own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void }) {
  return (
    <Section title="모델" hint="이 번역 프롬프트로 번역할 때 쓰는 모델이에요. 온도 같은 값은 설정 › 모델 설정에서 정해요.">
      <SettingGroup label="모델">
        <RolePicker role="aux" label="번역 모델" own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
