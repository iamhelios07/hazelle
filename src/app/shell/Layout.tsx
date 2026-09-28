import { useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { Shell, useWide } from '../ui';
import { Page } from './Page';
import { navigate, useRoute } from './router';
import { HOME, settingsPage, sidebarPage, type Route } from './routes';
import { SettingsSidebar } from './settings/SettingsNav';
import { LibrarySidebar } from './sidebar/LibrarySidebar';

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

export function Layout() {
  const route = useRoute();
  const wide = useWide();
  const [collapsed, setCollapsed] = usePersisted(COLLAPSED, (stored) => stored === '1', false, (folded) => (folded ? '1' : '0'));
  const settings = settingsPage(route);
  // Where 설정's × goes: the last place outside it, or home after a reload inside it (design: Secondary screens).
  const [outside, setOutside] = useState<Route>(HOME);
  if (settings === null && outside !== route) setOutside(route);
  const closeSettings = () => navigate(outside);
  const page = <Page route={route} closeSettings={closeSettings} />;

  // 설정 stands in for the library while it is open: "채팅은 채팅만 하는 거고, 설정 관련된 건 또 설정
  // 관련된 것만 하는 거" (user, 2026-09-28).
  if (settings !== null) return wide ? <Shell side={<SettingsSidebar current={settings} onClose={closeSettings} />}>{page}</Shell> : page;
  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={collapsed} onCollapse={setCollapsed} />;
  // On phones the character list is the home screen, a character's chats are its page, and every
  // other page takes the whole screen.
  if (!wide) return sidebarPage(route) ? sidebar(true) : page;
  return <Shell side={sidebar(false)}>{page}</Shell>;
}
