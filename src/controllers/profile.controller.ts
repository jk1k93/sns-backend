import type { Request, Response } from "express";
import { Gender, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { parseDateOnly } from "../helpers/date.helper.js";

export async function searchUserByPhone(req: Request, res: Response): Promise<void> {
  const phone = req.query.phone;
  if (typeof phone !== "string" || !phone.trim()) {
    res.status(400).json({ error: "phone query parameter is required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { phoneNumber: phone.trim() },
      select: { id: true, name: true, phoneNumber: true, email: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ message: "User fetched successfully", data: user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to search user" });
  }
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
