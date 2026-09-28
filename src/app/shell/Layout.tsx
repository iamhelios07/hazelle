import { useState } from 'react';
import { Shell, useWide } from '../ui';
import { LibrarySidebar } from './LibrarySidebar';
import { Page } from './Page';
import { useRoute } from './router';
import { sidebarPage } from './routes';

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

// A per-device convenience: private windows may refuse storage, and then the sidebar starts open.
function remembered(): boolean {
  try {
    return localStorage.getItem(COLLAPSED) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const route = useRoute();
  const wide = useWide();
  const [collapsed, setCollapsed] = useState(remembered);

  const collapse = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED, next ? '1' : '0');
    } catch {
      // Remembering is a convenience only.
    }
  };
  const sidebar = (page: boolean) => <LibrarySidebar page={page} collapsed={collapsed} onCollapse={collapse} />;

  // On phones the character list is the home screen, a character's chats are its page, and every
  // other page takes the whole screen.
  if (!wide) return sidebarPage(route) ? sidebar(true) : <Page route={route} />;
  return (
    <Shell side={sidebar(false)}>
      <Page route={route} />
    </Shell>
  );
}
