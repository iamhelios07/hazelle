import { ChoiceGroup } from '../ui';

type Props = { label: string; options: readonly string[]; value: string; onChange: (value: string) => void };

// A choice toggle's options, each valued by its place among them.
export function ToggleChoice({ label, options, value, onChange }: Props) {
  return <ChoiceGroup label={label} layout="fit" options={options.map((option, index) => ({ value: String(index), label: option }))} value={value} onChange={onChange} />;
}
