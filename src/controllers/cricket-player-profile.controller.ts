import type { Request, Response } from "express";
import { Hand, JerseySize, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";

const JERSEY_SIZES = new Set<string>(Object.values(JerseySize));
const HANDS = new Set<string>(Object.values(Hand));

const profileInclude = {
  role: { select: { id: true, name: true } },
} as const;

function parseHand(raw: unknown, field: string): { hand: Hand } | { error: string } {
  if (typeof raw !== "string" || !HANDS.has(raw)) {
    return { error: `${field} must be one of: ${[...HANDS].join(", ")}` };
  }
  return { hand: raw as Hand };
}

function parseJerseySize(raw: unknown): { size: JerseySize } | { error: string } {
  if (typeof raw !== "string" || !JERSEY_SIZES.has(raw)) {
    return { error: `jerseySize must be one of: ${[...JERSEY_SIZES].join(", ")}` };
  }
  return { size: raw as JerseySize };
}

export async function getCricketPlayerProfile(req: Request, res: Response): Promise<void> {
  const userId = paramId(req.params.userId);
  if (!userId || !isUuid(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const profile = await prisma.cricketPlayerProfile.findUnique({
      where: { userId },
      include: profileInclude,
    });
    if (!profile || profile.isDeleted) {
      res.status(404).json({ error: "Cricket player profile not found" });
      return;
    }
    res.status(200).json({ message: "Profile fetched successfully", data: profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function createCricketPlayerProfile(req: Request, res: Response): Promise<void> {
  const userId = req.auth!.userId;

  const {
    roleId: roleIdRaw,
    battingHand: battingHandRaw,
    bowlingHand: bowlingHandRaw,
    jerseyNumber: jerseyNumberRaw,
    jerseySize: jerseySizeRaw,
  } = req.body ?? {};

  let roleId: string | null = null;
  if (roleIdRaw !== undefined) {
    if (typeof roleIdRaw !== "string" || !isUuid(roleIdRaw)) {
      res.status(400).json({ error: "roleId must be a valid UUID" });
      return;
    }
    roleId = roleIdRaw;
  }

  let battingHand: Hand | null = null;
  if (battingHandRaw !== undefined) {
    const result = parseHand(battingHandRaw, "battingHand");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    battingHand = result.hand;
  }

  let bowlingHand: Hand | null = null;
  if (bowlingHandRaw !== undefined) {
    const result = parseHand(bowlingHandRaw, "bowlingHand");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    bowlingHand = result.hand;
  }

  let jerseyNumber: number | null = null;
  if (jerseyNumberRaw !== undefined) {
    if (typeof jerseyNumberRaw !== "number" || !Number.isInteger(jerseyNumberRaw) || jerseyNumberRaw < 0) {
      res.status(400).json({ error: "jerseyNumber must be a non-negative integer" });
      return;
    }
    jerseyNumber = jerseyNumberRaw;
  }

  let jerseySize: JerseySize | null = null;
  if (jerseySizeRaw !== undefined) {
    const result = parseJerseySize(jerseySizeRaw);
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    jerseySize = result.size;
  }

  try {
    const existing = await prisma.cricketPlayerProfile.findUnique({
      where: { userId },
      select: { id: true, isDeleted: true },
    });

    if (existing) {
      if (!existing.isDeleted) {
        res.status(409).json({ error: "Cricket player profile already exists for this user" });
        return;
      }
      // Reactivate a previously deleted profile
      const profile = await prisma.cricketPlayerProfile.update({
        where: { id: existing.id },
        data: { isDeleted: false, roleId, battingHand, bowlingHand, jerseyNumber, jerseySize },
        include: profileInclude,
      });
      res.status(201).json({ message: "Profile created successfully", data: profile });
      return;
    }

    if (roleId !== null) {
      const role = await prisma.cricketRole.findUnique({ where: { id: roleId }, select: { id: true } });
      if (!role) {
        res.status(400).json({ error: "Cricket role not found" });
        return;
      }
    }

    const profile = await prisma.cricketPlayerProfile.create({
      data: { userId, roleId, battingHand, bowlingHand, jerseyNumber, jerseySize },
      include: profileInclude,
    });

    res.status(201).json({ message: "Profile created successfully", data: profile });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced id does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create profile" });
  }
}

export async function updateCricketPlayerProfile(req: Request, res: Response): Promise<void> {
  const userId = paramId(req.params.userId);
  if (!userId || !isUuid(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  if (userId !== req.auth!.userId) {
    res.status(403).json({ error: "You can only update your own profile" });
    return;
  }

  const {
    roleId: roleIdRaw,
    battingHand: battingHandRaw,
    bowlingHand: bowlingHandRaw,
    jerseyNumber: jerseyNumberRaw,
    jerseySize: jerseySizeRaw,
  } = req.body ?? {};

  const data: Prisma.CricketPlayerProfileUpdateInput = {};

  if (roleIdRaw !== undefined) {
    if (roleIdRaw === null) {
      data.role = { disconnect: true };
    } else {
      if (typeof roleIdRaw !== "string" || !isUuid(roleIdRaw)) {
        res.status(400).json({ error: "roleId must be a valid UUID or null" });
        return;
      }
      data.role = { connect: { id: roleIdRaw } };
    }
  }

  if (battingHandRaw !== undefined) {
    if (battingHandRaw === null) {
      data.battingHand = null;
    } else {
      const result = parseHand(battingHandRaw, "battingHand");
      if ("error" in result) { res.status(400).json({ error: result.error }); return; }
      data.battingHand = result.hand;
    }
  }

  if (bowlingHandRaw !== undefined) {
    if (bowlingHandRaw === null) {
      data.bowlingHand = null;
    } else {
      const result = parseHand(bowlingHandRaw, "bowlingHand");
      if ("error" in result) { res.status(400).json({ error: result.error }); return; }
      data.bowlingHand = result.hand;
    }
  }

  if (jerseyNumberRaw !== undefined) {
    if (jerseyNumberRaw === null) {
      data.jerseyNumber = null;
    } else {
      if (typeof jerseyNumberRaw !== "number" || !Number.isInteger(jerseyNumberRaw) || jerseyNumberRaw < 0) {
        res.status(400).json({ error: "jerseyNumber must be a non-negative integer or null" });
        return;
      }
      data.jerseyNumber = jerseyNumberRaw;
    }
  }

  if (jerseySizeRaw !== undefined) {
    if (jerseySizeRaw === null) {
      data.jerseySize = null;
    } else {
      const result = parseJerseySize(jerseySizeRaw);
      if ("error" in result) { res.status(400).json({ error: result.error }); return; }
      data.jerseySize = result.size;
    }
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No fields provided to update" });
    return;
  }

  try {
    const existing = await prisma.cricketPlayerProfile.findUnique({
      where: { userId },
      select: { id: true, isDeleted: true },
    });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: "Cricket player profile not found" });
      return;
    }

    if (roleIdRaw !== null && roleIdRaw !== undefined) {
      const role = await prisma.cricketRole.findUnique({ where: { id: roleIdRaw }, select: { id: true } });
      if (!role) {
        res.status(400).json({ error: "Cricket role not found" });
        return;
      }
    }

    const profile = await prisma.cricketPlayerProfile.update({
      where: { userId },
      data,
      include: profileInclude,
    });

    res.status(200).json({ message: "Profile updated successfully", data: profile });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced id does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function deleteCricketPlayerProfile(req: Request, res: Response): Promise<void> {
  const userId = paramId(req.params.userId);
  if (!userId || !isUuid(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  if (userId !== req.auth!.userId) {
    res.status(403).json({ error: "You can only delete your own profile" });
    return;
  }

  try {
    const existing = await prisma.cricketPlayerProfile.findUnique({
      where: { userId },
      select: { id: true, isDeleted: true },
    });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: "Cricket player profile not found" });
      return;
    }

    await prisma.cricketPlayerProfile.update({ where: { userId }, data: { isDeleted: true } });

    res.status(200).json({ message: "Profile deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete profile" });
  }
}
