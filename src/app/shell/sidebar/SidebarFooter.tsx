import { Settings } from 'lucide-react';
import { SETTINGS } from '../../common/words';
import { NavRow, useWide } from '../../ui';
import { navigate } from '../router';
import { settingsEntry } from '../settings/SettingsNav';

// The library's one way into 설정, which holds connections, personas, defaults and the account.
export function SidebarFooter() {
  const wide = useWide();
  return <NavRow icon={Settings} label={SETTINGS} onClick={() => navigate(settingsEntry(wide))} />;
}
