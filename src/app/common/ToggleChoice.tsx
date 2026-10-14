import { ChoiceGroup } from '../ui';

type Props = { label: string; options: readonly string[]; value: string; onChange: (value: string) => void };

// A choice toggle's options, each valued by its place among them. A menu even for two or three, as Risu's select: a strip
// beside a toggle's name in the 토글 panel squeezed the name to a syllable a line (user, 2026-10-15).
export function ToggleChoice({ label, options, value, onChange }: Props) {
  return <ChoiceGroup label={label} layout="menu" options={options.map((option, index) => ({ value: String(index), label: option }))} value={value} onChange={onChange} />;
}
