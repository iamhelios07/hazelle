import type { ReactNode } from 'react';
import { Story } from './Story';
import styles from './StatusBox.module.css';

type Props = {
  // The script that draws it, as the bot named it; shown with actions, which a box among several has of its own.
  name: string;
  actions?: ReactNode;
  // null: the box was never drawn yet in this chat.
  html: string | null;
  css: string;
  onInert: () => void;
};

// A box of a bot's status window (상태창 지정) away from its message, as wide as the story's text as it is there.
export function StatusBox({ name, actions, html, css, onInert }: Props) {
  return (
    <section className={styles.box} aria-label={name}>
      {actions && (
        <div className={styles.head}>
          <h3 className={styles.name}>{name}</h3>
          {actions}
        </div>
      )}
      {html === null ? <p className={styles.none}>이 채팅에서 아직 그린 적이 없어요.</p> : <Story html={html} css={css} onInert={onInert} />}
    </section>
  );
}
