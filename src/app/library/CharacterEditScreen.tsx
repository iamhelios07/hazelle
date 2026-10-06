import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { CharacterEditor } from './CharacterEditor';

export function CharacterEditScreen({ shelf, back }: { shelf: CharacterShelf<ChatSummary>; back: Back | null }) {
  return <CharacterEditor shelf={shelf} frame={({ head, body }) => <Screen top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>} />;
}
