import { useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { SHORTCUT_GROUPS, SHORTCUTS, useShortcut } from '../shortcuts';
import { Dialog, Section, Shell, Shortcuts, Stack, Text, useWide } from '../ui';
import { Page } from './Page';
import { navigate, useRoute } from './router';
import { HOME, settingsPage, sidebarPage, type Route } from './routes';
import { settingsEntry, SettingsSidebar } from './settings/SettingsNav';
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
  const [listing, setListing] = useState(false);

  // The shell's handlers are the first mounted, so a screen's own handler for the same keys runs before them.
  useShortcut('settings', () => (settings === null ? navigate(settingsEntry(wide)) : closeSettings()));
  useShortcut('personas', () => navigate({ kind: 'personas' }));
  useShortcut('prompts', () => navigate({ kind: 'prompts' }));
  useShortcut('shortcutList', () => setListing((open) => !open));
  useShortcut('sidebar', () => (wide && settings === null ? setCollapsed(!collapsed) : false));

  const page = (
    <>
      <Page route={route} closeSettings={closeSettings} />
      {listing && <ShortcutList onClose={() => setListing(false)} />}
    </>
  );

  // 설정 stands in for the library while it is open: "채팅은 채팅만 하는 거고, 설정 관련된 건 또 설정
  // 관련된 것만 하는 거" (user, 2026-09-28).
  if (settings !== null) return wide ? <Shell side={<SettingsSidebar current={settings} onClose={closeSettings} />}>{page}</Shell> : page;
  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={collapsed} onCollapse={setCollapsed} />;
  // On phones the character list is the home screen, a character's chats are its page, and every
  // other page takes the whole screen.
  if (!wide) return sidebarPage(route) ? sidebar(true) : page;
  return <Shell side={sidebar(false)}>{page}</Shell>;
}

function ShortcutList({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="단축키" onClose={onClose}>
      <Stack gap="section">
        {SHORTCUT_GROUPS.map(({ title, note, names }) => (
          <Section key={title} title={title} level={3}>
            {note && (
              <Text size="sm" tone="muted">
                {note}
              </Text>
            )}
            <Shortcuts items={names.map((name) => SHORTCUTS[name])} />
          </Section>
        ))}
      </Stack>
    </Dialog>
  );
}
