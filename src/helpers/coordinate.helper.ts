export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
