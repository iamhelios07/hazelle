import { UserRound } from 'lucide-react';
import { useSettings, useViews } from '../session';
import { Avatar, ChipButton, Menu, MenuHeading, MenuItem, Tag } from '../ui';
import type { OpenChat } from './useChat';

// design §4.3: who the user plays in this chat. Without its own choice it follows the default, and a deleted one
// shows as missing.
export function ChatPersonaMenu({ chat }: { chat: OpenChat }) {
  const { persona, personaMenu } = chat;
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  const label = shown?.name ?? (persona.own ? '페르소나가 지워졌어요' : '기본 페르소나가 지워졌어요');
  return (
    <Menu
      handle={personaMenu}
      place="above-start"
      label="이 채팅에서 나는"
      trigger={(opener) => (
        <ChipButton
          label={label}
          title="이 채팅에서 나는"
          variant="ghost"
          opens="up"
          leading={<Avatar size="sm" tone="you" face={shown?.name ?? UserRound} image={shown?.picture} />}
          tone={shown ? 'default' : 'warn'}
          {...opener}
        />
      )}
    >
      <PersonaChoices chat={chat} />
    </Menu>
  );
}

// Mounted only while the menu is open.
function PersonaChoices({ chat }: { chat: OpenChat }) {
  const { persona, actions } = chat;
  const { personas } = useViews();
  const settings = useSettings();
  const fallback = personas.find(({ id }) => id === settings.persona);
  const own = persona.kind === 'persona' && persona.own ? persona.persona.id : null;
  return (
    <>
      <MenuHeading>이 채팅에서 나는</MenuHeading>
      <MenuItem label="기본 페르소나 따르기" sub={fallback?.value.name ?? '기본 페르소나가 지워졌어요'} checked={!persona.own} onClick={() => void actions.setOwn('persona', null)} />
      {personas.map(({ id, value }) => (
        <MenuItem
          key={id}
          label={value.name}
          sub={value.description.split('\n')[0] || undefined}
          avatar={<Avatar tone="you" face={value.name} image={value.picture} />}
          tag={id === settings.persona ? <Tag tone="accent">기본</Tag> : undefined}
          checked={id === own}
          onClick={() => void actions.setOwn('persona', id)}
        />
      ))}
    </>
  );
}
