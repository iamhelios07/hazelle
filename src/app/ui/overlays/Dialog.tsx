import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Kbd } from '../foundation/Kbd';
import { keyCaps, type Chord } from '../foundation/keys';
import { Row } from '../layout/Row';
import { Stack } from '../layout/Stack';
import styles from './Dialog.module.css';
import { useFocusTrap, useLayer } from './layers';

type Props = {
  title: string;
  note?: string;
  onClose: () => void;
  // Makes the body and its actions a form, so Enter in a field presses the submit button among the actions.
  onSubmit?: () => void;
  actions?: ReactNode;
  // full: each action stretched across the dialog, such as a form's 저장. row: side by side, such as a confirm's
  // 취소 and its action.
  actionsLayout?: 'full' | 'row';
  children: ReactNode;
};

// A small window over the page. Esc or a press on the page around it closes it.
export function Dialog({ title, note, onClose, onSubmit, actions, actionsLayout = 'row', children }: Props) {
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Only the scrim itself is outside: the toast sits above the dialog and stays pressable while it is open.
  useLayer(true, { outside: (target) => target === scrim.current, close: onClose });
  const trap = useFocusTrap(box);
  const body = actions ? (
    <Stack gap={actionsLayout === 'full' ? 'related' : 'group'}>
      {children}
      {actionsLayout === 'full' ? actions : <Row kind="actions">{actions}</Row>}
    </Stack>
  ) : (
    children
  );
  return (
    <div ref={scrim} className={styles.scrim}>
      <div ref={box} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />
        </div>
        {note && <p className={styles.note}>{note}</p>}
        <div className={styles.body}>
          {onSubmit ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </div>
      </div>
    </div>
  );
}

// Keyboard shortcuts, each with its keys drawn as key caps.
export function Shortcuts({ items }: { items: readonly { label: string; keys: readonly Chord[] }[] }) {
  return (
    <dl className={styles.shortcuts}>
      {items.map((item) => (
        <div key={item.label} className={styles.shortcut}>
          <dt className={styles.action}>{item.label}</dt>
          <dd className={styles.keys}>
            {item.keys.flatMap(keyCaps).map((cap) => (
              <Kbd key={cap}>{cap}</Kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
