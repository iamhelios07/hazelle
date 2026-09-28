import styles from './Divider.module.css';

type Props = { label: string } | { variant: 'menu' | 'tools' | 'rail' };

// A line between groups, drawn to suit where it sits. With a label it runs across the story, such as a day.
export function Divider(props: Props) {
  if ('label' in props) {
    return (
      <div className={styles.story} role="separator">
        <span className={styles.rule} />
        {props.label}
        <span className={styles.rule} />
      </div>
    );
  }
  return <span className={styles[props.variant]} role={props.variant === 'menu' ? 'separator' : undefined} />;
}
