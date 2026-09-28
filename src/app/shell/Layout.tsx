import { usePersisted } from '../common/usePersisted';
import { Shell, useWide } from '../ui';
import { Page } from './Page';
import { useRoute } from './router';
import { sidebarPage } from './routes';
import { LibrarySidebar } from './sidebar/LibrarySidebar';

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

export function Layout() {
  const route = useRoute();
  const wide = useWide();
  const [collapsed, setCollapsed] = usePersisted(COLLAPSED, (stored) => stored === '1', false, (folded) => (folded ? '1' : '0'));
  const sidebar = (page: boolean) => <LibrarySidebar page={page} collapsed={collapsed} onCollapse={setCollapsed} />;

  // On phones the character list is the home screen, a character's chats are its page, and every
  // other page takes the whole screen.
  if (!wide) return sidebarPage(route) ? sidebar(true) : <Page route={route} />;
  return (
    <Shell side={sidebar(false)}>
      <Page route={route} />
    </Shell>
  );
}
