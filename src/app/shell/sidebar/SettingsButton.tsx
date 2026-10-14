import { Settings } from 'lucide-react';
import { SETTINGS } from '../../common/words';
import { IconButton } from '../../ui';
import { navigate } from '../router';
import { settingsEntry } from '../settings/SettingsNav';

// The way into 설정 on phones, which have no rail.
export function SettingsButton() {
  return <IconButton icon={Settings} label={SETTINGS} size="sm" onClick={() => navigate(settingsEntry(false))} />;
}
