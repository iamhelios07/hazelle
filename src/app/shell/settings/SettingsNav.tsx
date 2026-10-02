import { ChevronRight, FileText, Layers, Lock, MessageSquare, Package, Plug, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { PAGES, SETTINGS } from '../../common/words';
import { useAccount, useConnections, useModules, usePersonas, usePrompts, useSession } from '../../session';
import { Icon, LayerSidebar, List, ListItem, NavBar, NavGroup, NavRow, Screen } from '../../ui';
import { navigate } from '../router';
import type { Route, SettingsPage } from '../routes';

type Place = { page: SettingsPage; label: string; icon: LucideIcon; route: Route };

// 설정's pages, in sets spaced apart. Only built pages are listed.
const GROUPS: Place[][] = [
  [
    { page: 'models', label: PAGES.models, icon: Layers, route: { kind: 'models' } },
    { page: 'connections', label: PAGES.connections, icon: Plug, route: { kind: 'connections' } },
  ],
  [
    { page: 'chat', label: PAGES.chat, icon: MessageSquare, route: { kind: 'chat-settings' } },
    { page: 'prompts', label: PAGES.prompts, icon: FileText, route: { kind: 'prompts' } },
    { page: 'personas', label: PAGES.personas, icon: User, route: { kind: 'personas' } },
    { page: 'modules', label: PAGES.modules, icon: Package, route: { kind: 'modules' } },
  ],
  [{ page: 'account', label: PAGES.account, icon: Lock, route: { kind: 'account', section: null } }],
];
const ADMIN: Place[] = [{ page: 'admin', label: PAGES.admin, icon: ShieldCheck, route: { kind: 'admin' } }];

// 운영 is listed to the operator alone.
function useGroups(): Place[][] {
  const { admin } = useAccount();
  return admin ? [...GROUPS, ADMIN] : GROUPS;
}

// Where the library's 설정 lands: the first page where the sidebar lists them all, the list on phones.
export const settingsEntry = (wide: boolean): Route => (wide ? GROUPS[0]![0]!.route : { kind: 'settings' });

export function SettingsSidebar({ current, onClose }: { current: SettingsPage | 'list'; onClose: () => void }) {
  const groups = useGroups();
  return (
    <LayerSidebar title={SETTINGS} onClose={onClose}>
      {groups.map((group) => (
        <NavGroup key={group[0]!.page}>
          {group.map((place) => (
            <NavRow key={place.page} icon={place.icon} label={place.label} current={place.page === current} onClick={() => navigate(place.route)} />
          ))}
        </NavGroup>
      ))}
    </LayerSidebar>
  );
}

// 설정 on phones: its pages as a list, each with what it holds.
export function SettingsList({ onClose }: { onClose: () => void }) {
  const prompts = usePrompts();
  const personas = usePersonas();
  const modules = useModules();
  const connections = useConnections();
  const { username } = useSession();
  const groups = useGroups();
  const holds: Record<SettingsPage, string | undefined> = {
    models: `${connections.reduce((sum, connection) => sum + connection.value.starred.length, 0)}개`,
    connections: `${connections.length}개`,
    chat: undefined,
    prompts: `${prompts.length}개`,
    personas: `${personas.length}개`,
    modules: `${modules.length}개`,
    account: username,
    admin: undefined,
  };
  return (
    <Screen top={<NavBar title={SETTINGS} close backLabel={`${SETTINGS} 닫기`} onBack={onClose} />}>
      {groups.map((group) => (
        <NavGroup key={group[0]!.page}>
          <List label={group.map((place) => place.label).join(', ')}>
            {group.map((place) => (
              <ListItem key={place.page} title={place.label} aside={holds[place.page]} trailing={<Icon icon={ChevronRight} />} onClick={() => navigate(place.route)} />
            ))}
          </List>
        </NavGroup>
      ))}
    </Screen>
  );
}
