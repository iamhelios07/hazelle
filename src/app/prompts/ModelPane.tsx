import { ROLES, type Assignment, type ModelRef, type Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { findStarred, GONE, HelperPickers, ROLE_WORDS, RolePicker } from '../common/RolePicker';
import { Section, SettingGroup, Text } from '../ui';

const DEFAULT = '전체 기본값 따르기';

// What the 모델 row says: this prompt's 본 대화, and how many helper roles it sets apart.
export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? (findStarred(models.main, connections)?.name ?? GONE) : DEFAULT;
  const apart = (Object.keys(ROLES) as Role[]).filter((role) => role !== 'main' && models[role]).length;
  return apart ? `${main} · 보조 ${apart}개` : main;
}

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

// The prompt's layer of the model assignment (design §4.1).
export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, a role takes 전체 기본값's own choice first, and only then the role it falls back to.
  const follow = (role: Role) => {
    const next = ROLES[role].fallsBackTo;
    return defaults[role] || !next ? DEFAULT : `${ROLE_WORDS[next]}와 같게`;
  };
  const picker = (role: Role, help?: string) => <RolePicker key={role} role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <>
      <Section title="모델">
        <Text tone="muted">이 프롬프트로 여는 채팅이 쓰는 모델이에요. 채팅에서 모델을 바꾸면 그 채팅만 바뀌어요. 온도 같은 값은 설정 › 모델 설정에서 정해요.</Text>
        <SettingGroup label="본 대화 모델">{picker('main')}</SettingGroup>
      </Section>
      <Section title="보조 모델">
        <Text tone="muted">장기 기억·번역·감정 에셋 기능은 아직 없어요. 기능이 들어오면 여기서 고른 모델을 써요.</Text>
        <HelperPickers models={models} picker={picker} />
      </Section>
    </>
  );
}
