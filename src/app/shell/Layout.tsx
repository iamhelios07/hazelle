import { useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { useDisplay } from '../display';
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
  // Two panels beside a chat fold the list for their room without touching the stored choice; opening it then keeps it
  // open until the pair closes.
  const [paired, setPaired] = useState(false);
  const [keptOpen, setKeptOpen] = useState(false);
  if (!paired && keptOpen) setKeptOpen(false);
  const folded = collapsed || (paired && !keptOpen);
  const fold = (to: boolean) => {
    if (paired) setKeptOpen(!to);
    setCollapsed(to);
  };
  const settings = settingsPage(route);
  // Where 설정's × goes: the last place outside it, or home after a reload inside it.
  const [outside, setOutside] = useState<Route>(HOME);
  if (settings === null && outside !== route) setOutside(route);
  const closeSettings = () => navigate(outside);
  const [listing, setListing] = useState(false);
  const { display, changeDisplay } = useDisplay();

  const fallback = { fallback: true };
  useShortcut('settings', () => (settings === null ? navigate(settingsEntry(wide)) : closeSettings()), fallback);
  useShortcut('personas', () => navigate({ kind: 'personas', place: null }), fallback);
  useShortcut('prompts', () => navigate({ kind: 'prompts', place: null }), fallback);
  useShortcut('shortcutList', () => setListing((open) => !open), fallback);
  useShortcut('sidebar', () => (wide && settings === null ? fold(!folded) : false), fallback);
  useShortcut('pictures', () => changeDisplay({ hidePictures: !display.hidePictures }), fallback);

  const page = (
    <>
      <Page route={route} closeSettings={closeSettings} onPaired={setPaired} />
      {listing && <ShortcutList onClose={() => setListing(false)} />}
    </>
  );

  if (settings !== null) return wide ? <Shell align="start" side={<SettingsSidebar current={settings} onClose={closeSettings} />}>{page}</Shell> : page;
  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={folded} onCollapse={fold} />;
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
              <Text variant="note">
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
