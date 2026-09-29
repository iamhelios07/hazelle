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
  // Where 설정's × goes: the last place outside it, or home after a reload inside it.
  const [outside, setOutside] = useState<Route>(HOME);
  if (settings === null && outside !== route) setOutside(route);
  const closeSettings = () => navigate(outside);
  const [listing, setListing] = useState(false);

  const fallback = { fallback: true };
  useShortcut('settings', () => (settings === null ? navigate(settingsEntry(wide)) : closeSettings()), fallback);
  useShortcut('personas', () => navigate({ kind: 'personas' }), fallback);
  useShortcut('prompts', () => navigate({ kind: 'prompts' }), fallback);
  useShortcut('shortcutList', () => setListing((open) => !open), fallback);
  useShortcut('sidebar', () => (wide && settings === null ? setCollapsed(!collapsed) : false), fallback);

  const page = (
    <>
      <Page route={route} closeSettings={closeSettings} />
      {listing && <ShortcutList onClose={() => setListing(false)} />}
    </>
  );

  // 설정 stands in for the library while it is open.
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
