import { UserRound } from 'lucide-react';
import { personaTitle } from '../common/persona-words';
import { useSettings, useViews } from '../session';
import { useToast } from '../toast';
import { Avatar, ChipButton, Divider, Menu, MenuHeading, MenuItem, Tag } from '../ui';
import type { OpenChat } from './useChat';

// Without its own choice it follows the default, and a deleted one shows as missing.
export function ChatPersonaMenu({ chat }: { chat: OpenChat }) {
  const { persona, personaMenu } = chat;
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  const label = shown ? personaTitle(shown) : (persona.own ? '페르소나가 지워졌어요' : '기본 페르소나가 지워졌어요');
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
      <Divider variant="menu" />
      <MenuItem label="페르소나 관리…" onClick={() => chat.actions.side({ kind: 'personas', id: null })} />
    </Menu>
  );
}

// Mounted only while the menu is open.
function PersonaChoices({ chat }: { chat: OpenChat }) {
  const { persona, actions } = chat;
  const { personas } = useViews();
  const settings = useSettings();
  const toast = useToast();
  const choose = (value: string | null) => void actions.setOwn('persona', value).then((saved) => saved.ok || toast.failed(saved));
  const fallback = personas.find(({ id }) => id === settings.persona);
  const own = persona.kind === 'persona' && persona.own ? persona.persona.id : null;
  return (
    <>
      <MenuHeading>이 채팅에서 나는</MenuHeading>
      <MenuItem label="기본 페르소나 따르기" sub={fallback ? personaTitle(fallback.value) : '기본 페르소나가 지워졌어요'} checked={!persona.own} onClick={() => choose(null)} />
      {personas.map(({ id, value }) => (
        <MenuItem
          key={id}
          label={personaTitle(value)}
          sub={value.description.split('\n')[0] || undefined}
          avatar={<Avatar tone="you" face={value.name} image={value.picture} />}
          tag={id === settings.persona ? <Tag tone="accent">기본</Tag> : undefined}
          checked={id === own}
          onClick={() => choose(id)}
        />
      ))}
    </>
  );
}
