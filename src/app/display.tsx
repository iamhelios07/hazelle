import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { DISPLAY_DEFAULT, parseDisplay, parseReading, presets, type Display, type Preset } from './common/reading';
import { readPersisted, usePersisted } from './common/usePersisted';
import { applyTheme, readingDefault, type Reading } from './ui';

// Per device, never in the synced settings, since a phone and a desktop screen differ (user, 2026-09-29).
const READING = 'risu-alpha:reading';
const DISPLAY = 'risu-alpha:display';

const parseStoredDisplay = (stored: string) => parseDisplay(stored, DISPLAY_DEFAULT);

// Before the first render, so a light theme never paints dark first.
export const applyStoredTheme = () => applyTheme(readPersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT).theme);

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
  useLayoutEffect(() => applyTheme(display.theme), [display.theme]);
  const pick = ({ look: { theme, ...look } }: Preset) => {
    setReading({ ...reading, ...look });
    setDisplay({ ...display, theme });
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
  return <DisplayContext value={control}>{children}</DisplayContext>;
}

export function useDisplay(): DisplayControl {
  const control = useContext(DisplayContext);
  if (!control) throw new Error('display hook outside DisplayProvider');
  return control;
}
