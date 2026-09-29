import { ChevronRight, FileText, Layers, Lock, Plug, SlidersHorizontal, User, type LucideIcon } from 'lucide-react';
import { useSession, useViews } from '../../session';
import { Icon, LayerSidebar, List, ListItem, NavBar, NavGroup, NavRow, Screen } from '../../ui';
import { navigate } from '../router';
import type { Route, SettingsPage } from '../routes';

type Place = { page: SettingsPage; label: string; icon: LucideIcon; route: Route };

// 설정's pages (design: Secondary screens). Only built pages are listed.
const GROUPS: { label: string; places: Place[] }[] = [
  {
    label: '대화',
    places: [
      { page: 'prompts', label: '프롬프트', icon: FileText, route: { kind: 'prompts' } },
      { page: 'personas', label: '페르소나', icon: User, route: { kind: 'personas' } },
    ],
  },
  {
    label: '모델',
    places: [
      { page: 'connections', label: '연결', icon: Plug, route: { kind: 'connections' } },
      { page: 'profiles', label: '모델 설정', icon: Layers, route: { kind: 'profiles' } },
    ],
  },
  {
    label: '일반',
    places: [
      { page: 'defaults', label: '기본값', icon: SlidersHorizontal, route: { kind: 'defaults' } },
      { page: 'account', label: '계정', icon: Lock, route: { kind: 'account' } },
    ],
  },
];

export const TITLE = '설정';

// Where the library's 설정 lands: the first page where the sidebar lists them all, the list on phones.
export const settingsEntry = (wide: boolean): Route => (wide ? GROUPS[0]!.places[0]!.route : { kind: 'settings' });

export function SettingsSidebar({ current, onClose }: { current: SettingsPage | 'list'; onClose: () => void }) {
  return (
    <LayerSidebar title={TITLE} onClose={onClose}>
      {GROUPS.map((group) => (
        <NavGroup key={group.label} label={group.label}>
          {group.places.map((place) => (
            <NavRow key={place.page} icon={place.icon} label={place.label} current={place.page === current} onClick={() => navigate(place.route)} />
          ))}
        </NavGroup>
      ))}
    </LayerSidebar>
  );
}

// 설정 on phones: its pages as a list, each with what it holds.
export function SettingsList({ onClose }: { onClose: () => void }) {
  const { prompts, personas, connections } = useViews();
  const { username } = useSession();
  const holds: Record<SettingsPage, string | undefined> = {
    prompts: `${prompts.length}개`,
    personas: `${personas.length}개`,
    connections: `${connections.length}곳`,
    profiles: `모델 ${connections.reduce((sum, connection) => sum + connection.value.starred.length, 0)}개`,
    defaults: undefined,
    account: username,
  };
  return (
    <Screen top={<NavBar title={TITLE} close backLabel={`${TITLE} 닫기`} onBack={onClose} />}>
      {GROUPS.map((group) => (
        <NavGroup key={group.label} label={group.label}>
          <List label={group.label}>
            {group.places.map((place) => (
              <ListItem key={place.page} title={place.label} aside={holds[place.page]} trailing={<Icon icon={ChevronRight} />} onClick={() => navigate(place.route)} />
            ))}
          </List>
        </NavGroup>
      ))}
    </Screen>
  );
}
