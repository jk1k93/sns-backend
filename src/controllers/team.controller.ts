import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";

const userSelect = { id: true, name: true, phoneNumber: true, email: true } as const;

const teamInclude = {
  captain: { select: userSelect },
  viceCaptain: { select: userSelect },
  owner: { select: userSelect },
  members: {
    where: { isDeleted: false },
    include: { user: { select: userSelect } },
  },
} as const;

type UserRef =
  | { kind: "userId"; userId: string }
  | { kind: "details"; name: string; phone: string };

function parseUserRef(raw: unknown, fieldName: string): { ref: UserRef } | { error: string } {
  if (typeof raw === "string") {
    if (!isUuid(raw)) return { error: `${fieldName} must be a valid UUID` };
    return { ref: { kind: "userId", userId: raw } };
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name !== "string" || !obj.name.trim()) {
      return { error: `${fieldName}.name must be a non-empty string` };
    }
    if (typeof obj.phone !== "string" || !obj.phone.trim()) {
      return { error: `${fieldName}.phone must be a non-empty string` };
    }
    return { ref: { kind: "details", name: obj.name.trim(), phone: obj.phone.trim() } };
  }
  return { error: `${fieldName} must be a UUID string or an object with name and phone` };
}

async function resolveUserRefInTx(
  ref: UserRef,
  fieldName: string,
  tx: Prisma.TransactionClient,
): Promise<string> {
  if (ref.kind === "userId") {
    const user = await tx.user.findUnique({ where: { id: ref.userId }, select: { id: true } });
    if (!user) throw Object.assign(new Error(`${fieldName} does not exist`), { statusCode: 400 });
    return ref.userId;
  }
  const user = await tx.user.upsert({
    where: { phoneNumber: ref.phone },
    update: {},
    create: { name: ref.name, phoneNumber: ref.phone },
    select: { id: true },
  });
  return user.id;
}

async function ensureTournamentPlayer(
  tournamentId: string,
  playerId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.tournamentPlayer.upsert({
    where: { tournamentId_playerId: { tournamentId, playerId } },
    update: { isDeleted: false },
    create: { tournamentId, playerId },
  });
}

function getTournamentId(req: Request): string | undefined {
  const raw = paramId(req.params.tournamentId);
  if (!raw || !isUuid(raw)) return undefined;
  return raw;
}

async function validateMemberIds(
  items: string[],
): Promise<{ ids: string[] } | { error: string }> {
  const ids = [...new Set(items)];
  if (ids.length === 0) return { ids };
  const found = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((u) => u.id));
    const missing = ids.filter((id) => !foundSet.has(id));
    return { error: `The following userIds do not exist: ${missing.join(", ")}` };
  }
  return { ids };
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId, isDeleted: false },
      select: { id: true },
    });
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    const teams = await prisma.team.findMany({
      where: { tournamentId, isDeleted: false },
      include: teamInclude,
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({ message: "Teams fetched successfully", data: teams });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
}

export async function getTeam(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }

  try {
    const team = await prisma.team.findUnique({ where: { id }, include: teamInclude });
    if (!team || team.isDeleted || team.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.status(200).json({ message: "Team fetched successfully", data: team });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch team" });
  }
}

export async function createTeam(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const {
    name: nameRaw,
    captain: captainRaw,
    viceCaptain: viceCaptainRaw,
    owner: ownerRaw,
    logoUrl: logoUrlRaw,
    shortCode: shortCodeRaw,
    members,
  } = req.body ?? {};

  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  let captainRef: UserRef | null = null;
  if (captainRaw !== undefined) {
    const result = parseUserRef(captainRaw, "captain");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    captainRef = result.ref;
  }

  let viceCaptainRef: UserRef | null = null;
  if (viceCaptainRaw !== undefined) {
    const result = parseUserRef(viceCaptainRaw, "viceCaptain");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    viceCaptainRef = result.ref;
  }

  let ownerRef: UserRef | null = null;
  if (ownerRaw !== undefined) {
    const result = parseUserRef(ownerRaw, "owner");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    ownerRef = result.ref;
  }

  const logoUrl: string | null =
    typeof logoUrlRaw === "string" && logoUrlRaw.trim() ? logoUrlRaw.trim() : null;

  let shortCode: string | null = null;
  if (shortCodeRaw !== undefined) {
    if (typeof shortCodeRaw !== "string") {
      res.status(400).json({ error: "shortCode must be a string" });
      return;
    }
    const trimmed = shortCodeRaw.trim();
    if (trimmed.length < 2 || trimmed.length > 5) {
      res.status(400).json({ error: "shortCode must be 2-5 characters" });
      return;
    }
    shortCode = trimmed;
  }

  let memberIds: string[] = [];
  if (members !== undefined) {
    if (!Array.isArray(members)) {
      res.status(400).json({ error: "members must be an array" });
      return;
    }
    const memberStrings: string[] = [];
    for (const item of members) {
      if (typeof item !== "string" || !isUuid(item)) {
        res.status(400).json({ error: `members must be an array of valid UUIDs; got "${item}"` });
        return;
      }
      memberStrings.push(item);
    }
    const result = await validateMemberIds(memberStrings);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    memberIds = result.ids;
  }

  try {
    const team = await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId, isDeleted: false },
        select: { id: true },
      });
      if (!tournament) throw Object.assign(new Error("Tournament not found"), { statusCode: 404 });

      const captainId = captainRef !== null
        ? await resolveUserRefInTx(captainRef, "captain", tx)
        : null;

      const viceCaptainId = viceCaptainRef !== null
        ? await resolveUserRefInTx(viceCaptainRef, "viceCaptain", tx)
        : null;

      const ownerId = ownerRef !== null
        ? await resolveUserRefInTx(ownerRef, "owner", tx)
        : req.auth!.userId;

      const newTeam = await tx.team.create({
        data: { tournamentId, name: nameRaw.trim(), captainId, viceCaptainId, ownerId, logoUrl, shortCode },
        select: { id: true },
      });

      if (captainId !== null) await ensureTournamentPlayer(tournamentId, captainId, tx);
      if (viceCaptainId !== null) await ensureTournamentPlayer(tournamentId, viceCaptainId, tx);

      for (const userId of memberIds) {
        await tx.teamMember.upsert({
          where: { teamId_userId: { teamId: newTeam.id, userId } },
          update: { isDeleted: false },
          create: { teamId: newTeam.id, userId },
        });
      }

      return tx.team.findUnique({ where: { id: newTeam.id }, include: teamInclude });
    });

    res.status(201).json({ message: "Team created successfully", data: team });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e) {
      if (e.statusCode === 404) { res.status(404).json({ error: e.message }); return; }
      if (e.statusCode === 400) { res.status(400).json({ error: e.message }); return; }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced userId does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create team" });
  }
}

export async function updateTeam(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }

  const {
    name: nameRaw,
    captain: captainRaw,
    viceCaptain: viceCaptainRaw,
    owner: ownerRaw,
    logoUrl: logoUrlRaw,
    shortCode: shortCodeRaw,
    members,
  } = req.body ?? {};

  const data: Prisma.TeamUpdateInput = {};

  if (nameRaw !== undefined) {
    if (typeof nameRaw !== "string" || !nameRaw.trim()) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    data.name = nameRaw.trim();
  }

  // null = clear the role; UserRef = set/change; undefined = no change
  let captainRef: UserRef | null | undefined;
  if (captainRaw !== undefined) {
    if (captainRaw === null) {
      captainRef = null;
    } else {
      const result = parseUserRef(captainRaw, "captain");
      if ("error" in result) { res.status(400).json({ error: result.error }); return; }
      captainRef = result.ref;
    }
  }

  let viceCaptainRef: UserRef | null | undefined;
  if (viceCaptainRaw !== undefined) {
    if (viceCaptainRaw === null) {
      viceCaptainRef = null;
    } else {
      const result = parseUserRef(viceCaptainRaw, "viceCaptain");
      if ("error" in result) { res.status(400).json({ error: result.error }); return; }
      viceCaptainRef = result.ref;
    }
  }

  let ownerRef: UserRef | undefined;
  if (ownerRaw !== undefined) {
    const result = parseUserRef(ownerRaw, "owner");
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    ownerRef = result.ref;
  }

  if (logoUrlRaw !== undefined) {
    data.logoUrl =
      typeof logoUrlRaw === "string" && logoUrlRaw.trim() ? logoUrlRaw.trim() : null;
  }

  if (shortCodeRaw !== undefined) {
    if (typeof shortCodeRaw !== "string") {
      res.status(400).json({ error: "shortCode must be a string" });
      return;
    }
    const trimmed = shortCodeRaw.trim();
    if (trimmed.length < 2 || trimmed.length > 5) {
      res.status(400).json({ error: "shortCode must be 2-5 characters" });
      return;
    }
    data.shortCode = trimmed;
  }

  let memberIds: string[] | undefined;
  if (members !== undefined) {
    if (!Array.isArray(members)) {
      res.status(400).json({ error: "members must be an array" });
      return;
    }
    const memberStrings: string[] = [];
    for (const item of members) {
      if (typeof item !== "string" || !isUuid(item)) {
        res.status(400).json({ error: `members must be an array of valid UUIDs; got "${item}"` });
        return;
      }
      memberStrings.push(item);
    }
    const result = await validateMemberIds(memberStrings);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    memberIds = result.ids;
  }

  const hasChanges =
    Object.keys(data).length > 0 ||
    captainRef !== undefined ||
    viceCaptainRef !== undefined ||
    ownerRef !== undefined ||
    memberIds !== undefined;

  if (!hasChanges) {
    res.status(400).json({ error: "No fields provided to update" });
    return;
  }

  try {
    const team = await prisma.$transaction(async (tx) => {
      const existing = await tx.team.findUnique({
        where: { id },
        select: { isDeleted: true, tournamentId: true },
      });
      if (!existing || existing.isDeleted || existing.tournamentId !== tournamentId) {
        throw Object.assign(new Error("Team not found"), { statusCode: 404 });
      }

      if (captainRef !== undefined) {
        if (captainRef === null) {
          data.captain = { disconnect: true };
        } else {
          const captainId = await resolveUserRefInTx(captainRef, "captain", tx);
          data.captain = { connect: { id: captainId } };
          await ensureTournamentPlayer(tournamentId, captainId, tx);
        }
      }

      if (viceCaptainRef !== undefined) {
        if (viceCaptainRef === null) {
          data.viceCaptain = { disconnect: true };
        } else {
          const viceCaptainId = await resolveUserRefInTx(viceCaptainRef, "viceCaptain", tx);
          data.viceCaptain = { connect: { id: viceCaptainId } };
          await ensureTournamentPlayer(tournamentId, viceCaptainId, tx);
        }
      }

      if (ownerRef !== undefined) {
        const ownerId = await resolveUserRefInTx(ownerRef, "owner", tx);
        data.owner = { connect: { id: ownerId } };
      }

      if (memberIds !== undefined) {
        await tx.teamMember.updateMany({ where: { teamId: id }, data: { isDeleted: true } });
        for (const userId of memberIds) {
          await tx.teamMember.upsert({
            where: { teamId_userId: { teamId: id, userId } },
            update: { isDeleted: false },
            create: { teamId: id, userId },
          });
        }
      }

      return tx.team.update({ where: { id }, data, include: teamInclude });
    });

    res.status(200).json({ message: "Team updated successfully", data: team });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e) {
      if (e.statusCode === 404) { res.status(404).json({ error: e.message }); return; }
      if (e.statusCode === 400) { res.status(400).json({ error: e.message }); return; }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced userId does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update team" });
  }
}

export async function deleteTeam(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }

  try {
    const team = await prisma.team.findUnique({
      where: { id },
      select: { id: true, isDeleted: true, tournamentId: true },
    });
    if (!team || team.isDeleted || team.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    await prisma.$transaction([
      prisma.team.update({ where: { id }, data: { isDeleted: true } }),
      prisma.teamMember.updateMany({ where: { teamId: id, isDeleted: false }, data: { isDeleted: true } }),
    ]);

    res.status(200).json({ message: "Team deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete team" });
  }
}
