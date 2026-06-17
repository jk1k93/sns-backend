import crypto from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;

export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOtp(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return /^\d{6}$/.test(trimmed) ? trimmed : null;
}
