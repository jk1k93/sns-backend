export function parseDate(value: string | undefined, field: string): { value?: Date; error?: string } {
  if (value === undefined) return { error: `${field} is required` };
  const d = new Date(value);
  if (isNaN(d.getTime())) return { error: `${field} must be a valid date` };
  return { value: d };
}

export function parseDateOnly(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}
