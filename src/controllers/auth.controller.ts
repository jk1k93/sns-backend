import type { Request, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../db.js";
import { generateOtpCode, normalizeOtp, normalizePhone, OTP_TTL_MS } from "../helpers/auth.helper.js";

export async function login(req: Request, res: Response): Promise<void> {
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  if (!phoneNumber) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  const otp = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phoneNumber },
      });
      if (!existing) {
        await tx.user.create({
          data: { phoneNumber },
        });
      }

      await tx.otp.updateMany({
        where: { phoneNumber, isUsed: false, expiresAt: { gt: new Date() } },
        data: { isUsed: true },
      });

      await tx.otp.create({
        data: {
          phoneNumber,
          otp,
          expiresAt,
        },
      });
    });

    res.status(200).json({
      message: "OTP sent",
      phoneNumber,
      otp,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to process login" });
  }
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  const otpCode = normalizeOtp(req.body?.otp);
  if (!phoneNumber || !otpCode) {
    res.status(400).json({
      error: "phoneNumber and a 6-digit otp are required",
    });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const otpRow = await tx.otp.findFirst({
        where: {
          phoneNumber,
          otp: otpCode,
          isUsed: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRow) {
        return { ok: false as const };
      }

      const marked = await tx.otp.updateMany({
        where: { id: otpRow.id, isUsed: false },
        data: { isUsed: true },
      });
      if (marked.count !== 1) {
        return { ok: false as const };
      }

      const user = await tx.user.findUnique({
        where: { phoneNumber },
      });
      if (!user) {
        return { ok: false as const };
      }

      return { ok: true as const, user };
    });

    if (!outcome.ok) {
      res.status(401).json({ error: "Invalid or expired OTP" });
      return;
    }

    const { user } = outcome;
    const signOptions: SignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
    };
    const token = jwt.sign(
      { sub: user.id, phoneNumber: user.phoneNumber },
      secret,
      signOptions
    );

    const newUser = !user.name?.trim();

    res.status(200).json({
      token,
      newUser,
      user,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
}
