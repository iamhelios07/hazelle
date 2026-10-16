import type { ReactElement } from 'react';
import { fitsRole, sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import { embedRoute } from '../../connectors/registry';
import type { Stored } from '../../model/kinds';
import { ChipButton, Empty, Menu, MenuHeading, MenuItem, PickCard, SettingRow } from '../ui';
import { MODEL_ROLES, MODEL_SETTINGS, NOT_STARRED, noStarred } from './words';

// 임베딩 모델 offers only what its connection embeds: the type says so, not the model (design §4).
export function starredModels(connections: readonly Stored<'connection'>[], role: Role) {
  return connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, role) && (role !== 'embed' || embedRoute(connection.value, model) !== null)).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
}

type Choice = ReturnType<typeof starredModels>[number];

// A heading wherever the connection changes: same-named models on two connections differ by heading, not by a grey
// line under each. Callers keep starredModels' order, which lists each connection's models together.
export function byConnection(choices: readonly Choice[], item: (choice: Choice) => ReactElement): ReactElement[] {
  return choices.flatMap((choice, at) =>
    choices[at - 1]?.ref.connection === choice.ref.connection ? [item(choice)] : [<MenuHeading key={`heading/${choice.ref.connection}`}>{choice.source}</MenuHeading>, item(choice)],
  );
}

export function findStarred(ref: ModelRef, connections: readonly Stored<'connection'>[]) {
  const connection = connections.find(({ id }) => id === ref.connection);
  const model = connection?.value.starred.find(({ id }) => id === ref.model);
  return connection && model ? { name: model.name, source: connection.value.label } : undefined;
}

// A starred model reads as its name and connection; one no longer starred reads as missing, never as another model.
function modelName(ref: ModelRef, connections: readonly Stored<'connection'>[]): string {
  const choice = findStarred(ref, connections);
  return choice ? `${choice.name} · ${choice.source}` : NOT_STARRED;
}

// label: a task's own model is picked from 보조 모델's models under the task's name.
type Props = {
  role: Role;
  label?: string;
  help?: string;
  own: ModelRef | undefined;
  // What leaving it unset means here; null where it cannot be left unset. It names no model: 대화 모델 differs by
  // chat, so a model named here would be wrong in any chat that picked another. 보조 모델 too: a chat's
  // conversation prompt outranks 공용's, and with neither set it falls back to the chat's 대화 모델.
  follow: string | null;
  connections: readonly Stored<'connection'>[];
  onPick: (ref: ModelRef | null) => void;
};

export function RolePicker({ role, label = MODEL_ROLES[role], help, own, follow, connections, onPick }: Props) {
  const current = own ? modelName(own, connections) : (follow ?? '정하지 않음');
  return (
    <SettingRow
      label={label}
      help={help}
      control={
        <Menu place="below-end" label={label} trigger={(opener) => <ChipButton variant="field" label={current} title={label} {...opener} />}>
          <RoleChoices role={role} own={own} follow={follow} connections={connections} onPick={onPick} />
        </Menu>
      }
    />
  );
}

// values: what the chosen model's 모델 설정 sets, under its connection; open: the door to that model's page, the
// menu's first item, so the values are read on the card and reached in one press.
type CardProps = Omit<Props, 'label'> & { values?: string; open?: () => void };

// RolePicker's choices from a card that leads its page: the model's name, and its connection under it.
export function RoleCard({ role, help, own, follow, connections, onPick, values, open }: CardProps) {
  const label = MODEL_ROLES[role];
  const choice = own && findStarred(own, connections);
  return (
    <Menu
      label={label}
      trigger={(opener) => (
        <PickCard
          label={label}
          value={own ? (choice ? choice.name : NOT_STARRED) : (follow ?? '정하지 않음')}
          note={choice ? [choice.source, values].filter(Boolean).join(' · ') : undefined}
          help={help}
          tone={own && !choice ? 'warn' : 'default'}
          popup="menu"
          expanded={opener.expanded}
          ref={opener.ref}
          onClick={opener.onClick}
        />
      )}
    >
      <RoleChoices role={role} own={own} follow={follow} connections={connections} onPick={onPick} open={open} />
    </Menu>
  );
}

function RoleChoices({ role, own, follow, connections, onPick, open }: CardProps) {
  const starred = starredModels(connections, role);
  return (
    <>
      {open && <MenuItem tone="muted" label={`${MODEL_SETTINGS} 열기`} onClick={open} />}
      {follow && <MenuItem label={follow} checked={!own} onClick={() => onPick(null)} />}
      {own && !findStarred(own, connections) && <MenuItem label={NOT_STARRED} sub={own.model} checked onClick={() => undefined} />}
      {starred.length === 0 ? (
        <Empty variant="menu">{noStarred('선택할 수 있어요')}</Empty>
      ) : (
        byConnection(starred, (choice) => (
          <MenuItem key={`${choice.ref.connection}/${choice.ref.model}`} label={choice.name} checked={!!own && sameModelRef(own, choice.ref)} onClick={() => onPick(choice.ref)} />
        ))
      )}
    </>
  );
}
