import { Select } from "./ui";

export const SEGMENTS = [
  { value: "nail", label: "Nail designer" },
  { value: "sobrancelha", label: "Design de sobrancelhas" },
  { value: "barbearia", label: "Barbearia" },
  { value: "salao", label: "Salão de beleza" },
  { value: "estetica", label: "Estética" },
  { value: "massagem", label: "Massagem" },
  { value: "outro", label: "Outro" },
];

export function SegmentSelect({ name = "segment", defaultValue }: { name?: string; defaultValue?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? "nail"}>
      {SEGMENTS.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}
