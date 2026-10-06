import { useState } from 'react';
import { Button, ChipButton, Divider, Menu, MenuItem, Row, TextField, useMenuClose } from '../ui';
import { LANGUAGES, languageLabel, withRo } from './languages';

// The language a translation goes into, picked inside its sentence: "응답을 [한국어]로 번역해서 보기".
export function IntoLanguage({ before, after, label, value, opens, onPick }: { before: string; after: string; label: string; value: string; opens: 'up' | 'down'; onPick: (name: string) => void }) {
  const word = languageLabel(value);
  return (
    <>
      {before}
      <LanguageMenu label={label} value={value} opens={opens} onPick={onPick} />
      {`${withRo(word).slice(word.length)} ${after}`}
    </>
  );
}

export function LanguageMenu({ label, value, opens, onPick }: { label: string; value: string; opens: 'up' | 'down'; onPick: (name: string) => void }) {
  return (
    <Menu kind="dialog" place={opens === 'up' ? 'above-start' : 'below-start'} label={label} trigger={(opener) => <ChipButton opens={opens} label={languageLabel(value)} title={label} {...opener} />}>
      <LanguageChoices value={value} onPick={onPick} />
    </Menu>
  );
}

// Mounted only while the menu is open, so a language typed and left starts empty again.
function LanguageChoices({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const close = useMenuClose();
  const [typed, setTyped] = useState('');
  const pick = (name: string) => {
    onPick(name);
    close();
  };
  return (
    <>
      {LANGUAGES.map((language) => (
        <MenuItem key={language.name} label={language.label} checked={language.name === value} onClick={() => pick(language.name)} />
      ))}
      <Divider variant="menu" />
      <TextField label="다른 언어" value={typed} onChange={setTyped} placeholder="예: Ukrainian" help="목록에 없는 언어는 영어 이름으로 입력해 주세요." />
      <Row kind="actions">
        <Button size="sm" disabled={!typed.trim()} onClick={() => pick(typed.trim())}>
          이 언어로 쓰기
        </Button>
      </Row>
    </>
  );
}
