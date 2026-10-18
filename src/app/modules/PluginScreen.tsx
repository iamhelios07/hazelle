import type { Stored } from '../../model/kinds';
import { PAGES } from '../common/words';
import type { Back } from '../shell/routes';
import { Screen } from '../ui';
import { AlwaysSwitch, UsedBy, useModuleEditor } from './ModuleScreen';
import { ToolSection } from './ToolSection';

export function PluginScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const { top, describing } = useModuleEditor(stored, PAGES.plugins, { kind: 'plugins' }, back);
  return (
    <Screen width="form" top={top}>
      {describing}
      <AlwaysSwitch id={stored.id} />
      <ToolSection module={stored} />
      <UsedBy id={stored.id} />
    </Screen>
  );
}
