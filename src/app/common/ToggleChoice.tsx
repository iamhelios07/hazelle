import { ChipButton, ChoiceGroup, Menu, MenuItem } from '../ui';

// A strip holds a few short options. A bot's toggle may bring dozens of long ones, which a strip squeezes to a letter
// wide each; those open as a menu.
const STRIP = { options: 4, letters: 14 };

type Props = { label: string; options: readonly string[]; value: string; onChange: (value: string) => void };

// A choice toggle's options, each valued by its place among them.
export function ToggleChoice({ label, options, value, onChange }: Props) {
  if (options.length <= STRIP.options && options.join('').length <= STRIP.letters) {
    return <ChoiceGroup label={label} layout="segmented" options={options.map((option, index) => ({ value: String(index), label: option }))} value={value} onChange={onChange} />;
  }
  return (
    <Menu label={label} place="below-end" trigger={(opener) => <ChipButton variant="field" label={options[Number(value)] ?? value} title={label} {...opener} />}>
      {options.map((option, index) => (
        <MenuItem key={index} label={option} checked={String(index) === value} onClick={() => onChange(String(index))} />
      ))}
    </Menu>
  );
}
