import { Settings, Wrench } from 'lucide-react';
import { SETTINGS, TOOLS } from '../../common/words';
import { IconButton, Row } from '../../ui';
import { navigate } from '../router';
import { settingsEntry } from '../settings/SettingsNav';
import { toolsEntry } from '../tools/ToolsNav';

// The ways into 도구 and 설정 on phones, which have no rail.
export function LayerButtons() {
  return (
    <Row kind="toolbar">
      <IconButton icon={Wrench} label={TOOLS} size="sm" onClick={() => navigate(toolsEntry(false))} />
      <IconButton icon={Settings} label={SETTINGS} size="sm" onClick={() => navigate(settingsEntry(false))} />
    </Row>
  );
}
