export function queryString(value: unknown): string | undefined {
  const v =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : undefined;
  return v;
}
