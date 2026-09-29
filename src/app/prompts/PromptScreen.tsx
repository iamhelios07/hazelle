import type { Stored } from '../../model/kinds';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { EditorFrame, NavBar, Screen, useWide } from '../ui';
import { PromptEditor } from './PromptEditor';

export function PromptScreen({ stored, pane, back }: { stored: Stored<'prompt'>; pane: 'toggles' | null; back: Back }) {
  const wide = useWide();
  return (
    <PromptEditor
      stored={stored}
      layout={wide ? 'split' : 'drill'}
      pane={pane}
      onPane={(next) => navigate({ kind: 'prompt', id: stored.id, pane: next }, { replace: true })}
      backLabel={back.label}
      onBack={() => navigate(back.to)}
      onCopied={(id) => navigate({ kind: 'prompt', id, pane: null })}
      onErased={() => navigate(back.to, { replace: true })}
      frame={({ head, body, side, open }) =>
        side === undefined ? (
          <Screen top={<NavBar {...head} />}>{body}</Screen>
        ) : (
          <EditorFrame top={<NavBar {...head} />} side={side} page={open}>
            {body}
          </EditorFrame>
        )
      }
    />
  );
}
