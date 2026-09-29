import { fitsRole, type ModelRef, type Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { ChipButton, Empty, Menu, MenuItem, SettingRow } from '../ui';

export const ROLE_WORDS: Record<Role, string> = { main: '본 대화', aux: '기타 보조', memory: '장기 기억', translate: '번역', emotion: '감정 에셋' };

const GONE = '별표 목록에 없는 모델';
const same = (a: ModelRef, b: ModelRef) => a.connection === b.connection && a.model === b.model;

export function starredModels(connections: readonly Stored<'connection'>[], role: Role) {
  return connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, role)).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
}

export function findStarred(ref: ModelRef, connections: readonly Stored<'connection'>[]) {
  const connection = connections.find(({ id }) => id === ref.connection);
  const model = connection?.value.starred.find(({ id }) => id === ref.model);
  return connection && model ? { name: model.name, source: connection.value.label } : undefined;
}

// A starred model reads as its name and connection; one no longer starred reads as missing, never as another model.
export function modelName(ref: ModelRef, connections: readonly Stored<'connection'>[]): string {
  const choice = findStarred(ref, connections);
  return choice ? `${choice.name} · ${choice.source}` : GONE;
}

type Props = {
  role: Role;
  help?: string;
  // This layer's own choice.
  own: ModelRef | undefined;
  // What leaving it unset means here, and the model that comes to; null where it cannot be left unset.
  follow: { label: string; model: string } | null;
  connections: readonly Stored<'connection'>[];
  onPick: (ref: ModelRef | null) => void;
};

// One role of one layer of the model assignment (design §4.1).
export function RolePicker({ role, help, own, follow, connections, onPick }: Props) {
  const label = `${ROLE_WORDS[role]} 모델`;
  const starred = starredModels(connections, role);
  const current = own ? modelName(own, connections) : (follow?.label ?? '정하지 않음');
  return (
    <SettingRow
      label={label}
      help={help}
      note={!own && follow ? `지금은 ${follow.model}` : undefined}
      control={
        <Menu place="below-end" label={label} trigger={(opener) => <ChipButton variant="field" label={current} title={label} {...opener} />}>
          {follow && <MenuItem label={follow.label} sub={follow.model} checked={!own} onClick={() => onPick(null)} />}
          {own && !findStarred(own, connections) && <MenuItem label={GONE} sub={own.model} checked onClick={() => undefined} />}
          {starred.length === 0 ? (
            <Empty variant="menu">별표 찍은 모델이 없어요. 연결에서 모델에 별표를 찍으면 여기서 고를 수 있어요.</Empty>
          ) : (
            starred.map((choice) => (
              <MenuItem
                key={`${choice.ref.connection}/${choice.ref.model}`}
                label={choice.name}
                sub={choice.source}
                checked={!!own && same(own, choice.ref)}
                onClick={() => onPick(choice.ref)}
              />
            ))
          )}
        </Menu>
      }
    />
  );
}
