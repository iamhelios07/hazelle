import { Settings } from 'lucide-react';
import { SETTINGS } from '../../common/words';
import { NavRow } from '../../ui';
import { navigate } from '../router';
import { settingsEntry } from '../settings/SettingsNav';

// The way into 설정 on phones, which have no rail.
export function SidebarFooter() {
  return <NavRow icon={Settings} label={SETTINGS} onClick={() => navigate(settingsEntry(false))} />;
}
