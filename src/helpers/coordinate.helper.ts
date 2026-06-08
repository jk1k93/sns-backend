export type CoordinateKind = "latitude" | "longitude";
export type CoordinateInput = number | null | "" | undefined;

export type CoordinateParseResult = {
  value: number | null | undefined;
  error?: string;
};

export function parseCoordinate(
  raw: CoordinateInput,
  kind: CoordinateKind,
): CoordinateParseResult {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === "") return { value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { value: undefined, error: `${kind} must be a number or null` };
  }
  if (kind === "latitude" && (raw < -90 || raw > 90)) {
    return { value: undefined, error: "latitude must be between -90 and 90" };
  }
  if (kind === "longitude" && (raw < -180 || raw > 180)) {
    return { value: undefined, error: "longitude must be between -180 and 180" };
  }
  return { value: raw };
}
