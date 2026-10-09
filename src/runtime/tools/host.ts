import type { ToolUnit } from '../../model/tool';
import type { Scripts } from '../scripts';
import { noOutcome, type Binding } from '../script-binding';
import type { Session } from '../session';
import type { Tools } from './facade';
import { toolsOf } from './store';

export function createTools(session: Pick<Session, 'store' | 'files'>, scripts: () => Scripts): Tools & Binding<ToolUnit> {
  return {
    warm: () => Promise.resolve(),
    menus: (chat) => {
      const stored = session.store.get('chat', chat);
      return stored ? toolsOf(session.store, stored.value).map(({ module, tool }) => ({ module, manifest: tool.manifest })) : [];
    },
    page: () => { scripts(); return () => {}; },
    settingsChanged: () => {},
    run: () => Promise.resolve(noOutcome()),
    close: () => {},
  };
}
