import type { Request, Response } from "express";
import { Gender, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";

function parseDateOnly(input: string): Date | null {
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

export async function getProfile(req: Request, res: Response): Promise<void> {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const newUser = !user.name?.trim();

    res.status(200).json({
      message: "user details fetched successfully",
      data: {
        newUser,
        user,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const nameRaw = req.body?.name;
  const genderRaw = req.body?.gender;
  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (genderRaw !== Gender.M && genderRaw !== Gender.F) {
    res.status(400).json({ error: "gender must be M or F" });
    return;
  }

  const data: Prisma.UserUpdateInput = {
    name: nameRaw.trim(),
    gender: genderRaw,
  };

  if ("email" in req.body) {
    const e = req.body.email;
    if (e === null || e === "") {
      data.email = null;
    } else if (typeof e === "string") {
      const t = e.trim();
      data.email = t.length > 0 ? t : null;
    } else {
      res.status(400).json({ error: "email must be a string or null" });
      return;
    }
  }

  if ("dateOfBirth" in req.body) {
    const d = req.body.dateOfBirth;
    if (d === null || d === "") {
      data.dateOfBirth = null;
    } else if (typeof d === "string") {
      const parsed = parseDateOnly(d);
      if (!parsed) {
        res.status(400).json({ error: "dateOfBirth must be YYYY-MM-DD" });
        return;
      }
      data.dateOfBirth = parsed;
    } else {
      res.status(400).json({ error: "dateOfBirth must be a string or null" });
      return;
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    const newUser = !user.name?.trim();

    res.status(200).json({
      message: "user details saved successfully",
      data: {
        newUser,
        user,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to save user details" });
  }
}
