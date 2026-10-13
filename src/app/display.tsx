import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { DISPLAY_DEFAULT, parseDisplay, parseReading, presets, type Display, type Preset } from './common/reading';
import { readPersisted, usePersisted } from './common/usePersisted';
import { applyScheme, readingDefault, VeilContext, type Reading } from './ui';

// Per device, never in the synced settings, since a phone and a desktop screen differ (user, 2026-09-29).
const READING = 'risu-alpha:reading';
const DISPLAY = 'risu-alpha:display';

const parseStoredDisplay = (stored: string) => parseDisplay(stored, DISPLAY_DEFAULT);

// Before the first render, so a light theme or a picked color never paints the default first.
export const applyStoredScheme = () => applyScheme(readPersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT));

type DisplayControl = {
  reading: Reading;
  display: Display;
  presets: Preset[];
  changeReading: (change: Partial<Reading>) => void;
  changeDisplay: (change: Partial<Display>) => void;
  pick: (preset: Preset) => void;
  reset: () => void;
};

const DisplayContext = createContext<DisplayControl | null>(null);

// The one owner of both stores: two usePersisted on one key would not see each other's writes, so the chat's 읽기 설정
// and 설정 › 디스플레이 both edit through this.
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readingDefault);
  const [list] = useState(() => presets(initial));
  const [reading, setReading] = usePersisted(READING, (stored) => parseReading(stored, initial), initial);
  const [display, setDisplay] = usePersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT);
  const { theme, bg, ink, accent, dialogue } = display;
  useLayoutEffect(() => applyScheme({ theme, bg, ink, accent, dialogue }), [theme, bg, ink, accent, dialogue]);
  const veil = useMemo(() => (display.hidePictures ? { revealed: new Set<string>() } : null), [display.hidePictures]);
  const pick = ({ look: { theme, bg, ink, accent, dialogue, ...look } }: Preset) => {
    setReading({ ...reading, ...look });
    setDisplay({ ...display, theme, bg, ink, accent, dialogue });
  };
  const control: DisplayControl = {
    reading,
    display,
    presets: list,
    changeReading: (change) => setReading({ ...reading, ...change }),
    changeDisplay: (change) => setDisplay({ ...display, ...change }),
    pick,
    reset: () => pick(list[0]!),
  };
  return (
    <DisplayContext value={control}>
      <VeilContext value={veil}>{children}</VeilContext>
    </DisplayContext>
  );
}

export function useDisplay(): DisplayControl {
  const control = useContext(DisplayContext);
  if (!control) throw new Error('display hook outside DisplayProvider');
  return control;
}
