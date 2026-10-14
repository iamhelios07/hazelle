import { ChoiceGroup } from '../ui';

type Props = { label: string; options: readonly string[]; value: string; onChange: (value: string) => void };

// A choice toggle's options, each valued by its place among them. A menu even for two or three, as Risu's select, and
// beside the name: a strip or a field squeezed the name to a syllable a line, and a field under it read as the next
// toggle's (user, 2026-10-15).
export function ToggleChoice({ label, options, value, onChange }: Props) {
  return <ChoiceGroup label={label} layout="menu" options={options.map((option, index) => ({ value: String(index), label: option }))} value={value} onChange={onChange} />;
}
