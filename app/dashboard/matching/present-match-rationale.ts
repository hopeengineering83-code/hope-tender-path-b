export function presentMatchRationale(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/[✓✔☑⚠⚠️▲▼←→]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\[\s+/, "[")
    .trim();
}
