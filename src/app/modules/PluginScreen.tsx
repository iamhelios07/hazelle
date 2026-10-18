import type { Stored } from '../../model/kinds';
import type { Back } from '../shell/routes';
import { Screen } from '../ui';
import { AlwaysSwitch, UsedBy, useModuleEditor } from './ModuleScreen';
import { PluginSection } from './PluginSection';

export function PluginScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const { top, describing } = useModuleEditor(stored, 'plugins', back);
  return (
    <Screen width="form" top={top}>
      {describing}
      <AlwaysSwitch id={stored.id} />
      <PluginSection module={stored} />
      <UsedBy id={stored.id} />
    </Screen>
  );
}
