import { Fragment } from 'react';
import { FONT_IDS, FONT_KIND, FONTS, loadFont, type FontId, type FontKind } from '../foundation/fonts';
import { Menu, MenuHeading, MenuItem } from '../overlays/Menu';
import { ChipButton } from './ChipButton';

const KINDS = Object.keys(FONT_KIND) as FontKind[];

// Each name is drawn in its own face, so opening fetches every face at once.
export function FontPicker({ label, value, onChange }: { label: string; value: FontId; onChange: (font: FontId) => void }) {
  return (
    <Menu
      label={label}
      place="end"
      trigger={(opener) => (
        <ChipButton
          variant="field"
          label={FONTS[value].label}
          title={label}
          {...opener}
          onClick={() => {
            for (const id of FONT_IDS) loadFont(id);
            opener.onClick();
          }}
        />
      )}
    >
      {KINDS.map((kind) => (
        <Fragment key={kind}>
          <MenuHeading>{FONT_KIND[kind]}</MenuHeading>
          {FONT_IDS.filter((id) => FONTS[id].kind === kind).map((id) => (
            <MenuItem key={id} label={FONTS[id].label} face={id} checked={id === value} onClick={() => onChange(id)} />
          ))}
        </Fragment>
      ))}
    </Menu>
  );
}
