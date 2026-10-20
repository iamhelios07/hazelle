import type { Stored } from '../../model/kinds';
import { framePage } from '../common/frame';
import { navigate } from '../shell/router';
import type { Back, PromptPane } from '../shell/routes';
import { useWide } from '../ui';
import { PromptEditor } from './PromptEditor';

export function PromptScreen({ stored, pane, back }: { stored: Stored<'prompt'>; pane: PromptPane | null; back: Back }) {
  const wide = useWide();
  return (
    <PromptEditor
      stored={stored}
      layout={wide ? 'split' : 'drill'}
      pane={pane}
      onPane={(next) => navigate({ kind: 'prompt', id: stored.id, pane: next }, { replace: true })}
      backLabel={back.label}
      onBack={() => navigate(back.to)}
      onOpen={(id) => navigate({ kind: 'prompt', id, pane: null })}
      onErased={() => navigate(back.to, { replace: true })}
      frame={framePage}
    />
  );
}
