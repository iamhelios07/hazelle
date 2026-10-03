import type { ReactNode } from 'react';
import { Story, type BotButton } from './Story';
import styles from './StatusBox.module.css';

type Props = {
  name: string;
  actions?: ReactNode;
  // null: the box was never drawn yet in this chat.
  html: string | null;
  css: string;
  buttons: 'live' | 'inert';
  onPress: (button: BotButton | null) => void;
};

export function StatusBox({ name, actions, html, css, buttons, onPress }: Props) {
  return (
    <section className={styles.box} aria-label={name}>
      {actions && (
        <div className={styles.head}>
          <h3 className={styles.name}>{name}</h3>
          {actions}
        </div>
      )}
      {html === null ? <p className={styles.none}>이 채팅에서 아직 그린 적이 없어요.</p> : <Story html={html} css={css} buttons={buttons} onPress={onPress} />}
    </section>
  );
}
