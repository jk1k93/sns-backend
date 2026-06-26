import type { Request, Response } from "express";
import { JerseySize, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";

const JERSEY_SIZES = new Set<string>(Object.values(JerseySize));

function parseJerseySize(raw: unknown): { size: JerseySize } | { error: string } {
  if (typeof raw !== "string" || !JERSEY_SIZES.has(raw)) {
    return { error: `jerseySize must be one of: ${[...JERSEY_SIZES].join(", ")}` };
  }
  return { size: raw as JerseySize };
}

const tournamentPlayerInclude = {
  player: { select: { id: true, name: true, phoneNumber: true, email: true } },
  team: { select: { id: true, name: true, shortCode: true } },
  role: { select: { id: true, name: true } },
} as const;

function getTournamentId(req: Request): string | undefined {
  const raw = paramId(req.params.tournamentId);
  if (!raw || !isUuid(raw)) return undefined;
  return raw;
}

export async function listTournamentPlayers(req: Request, res: Response): Promise<void> {
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

    const players = await prisma.tournamentPlayer.findMany({
      where: { tournamentId, isDeleted: false },
      include: tournamentPlayerInclude,
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json({ message: "Players fetched successfully", data: players });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch players" });
  }
}

export async function getTournamentPlayer(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }

  try {
    const record = await prisma.tournamentPlayer.findUnique({
      where: { id },
      include: tournamentPlayerInclude,
    });
    if (!record || record.isDeleted || record.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Player not found in this tournament" });
      return;
    }

    res.status(200).json({ message: "Player fetched successfully", data: record });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch player" });
  }
}

export async function addTournamentPlayer(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const {
    playerId: playerIdRaw,
    roleId: roleIdRaw,
    jerseyNumber: jerseyNumberRaw,
    jerseySize: jerseySizeRaw,
  } = req.body ?? {};

  if (typeof playerIdRaw !== "string" || !isUuid(playerIdRaw)) {
    res.status(400).json({ error: "playerId must be a valid UUID" });
    return;
  }

  let roleId: string | null = null;
  if (roleIdRaw !== undefined) {
    if (typeof roleIdRaw !== "string" || !isUuid(roleIdRaw)) {
      res.status(400).json({ error: "roleId must be a valid UUID" });
      return;
    }
    roleId = roleIdRaw;
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
    const record = await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId, isDeleted: false },
        select: { id: true },
      });
      if (!tournament) throw Object.assign(new Error("Tournament not found"), { statusCode: 404 });

      const user = await tx.user.findUnique({ where: { id: playerIdRaw }, select: { id: true } });
      if (!user) throw Object.assign(new Error("Player (user) not found"), { statusCode: 400 });

      if (roleId !== null) {
        const role = await tx.cricketRole.findUnique({ where: { id: roleId }, select: { id: true } });
        if (!role) throw Object.assign(new Error("Cricket role not found"), { statusCode: 400 });
      }

      const existing = await tx.tournamentPlayer.findUnique({
        where: { tournamentId_playerId: { tournamentId, playerId: playerIdRaw } },
        select: { id: true, isDeleted: true },
      });
      if (existing && !existing.isDeleted) {
        throw Object.assign(new Error("Player is already registered in this tournament"), { statusCode: 409 });
      }

      const tournamentPlayer = existing
        ? await tx.tournamentPlayer.update({
            where: { id: existing.id },
            data: { isDeleted: false, teamId: null, bidPrice: null, roleId, jerseyNumber, jerseySize },
            include: tournamentPlayerInclude,
          })
        : await tx.tournamentPlayer.create({
            data: { tournamentId, playerId: playerIdRaw, roleId, jerseyNumber, jerseySize },
            include: tournamentPlayerInclude,
          });

      // Backfill CricketPlayerProfile for any fields the client sent that aren't already set there
      if (roleId !== null || jerseyNumber !== null || jerseySize !== null) {
        const profile = await tx.cricketPlayerProfile.findUnique({
          where: { userId: playerIdRaw },
          select: { roleId: true, jerseyNumber: true, jerseySize: true, isDeleted: true },
        });

        const fill: Prisma.CricketPlayerProfileCreateInput = { user: { connect: { id: playerIdRaw } } };
        const update: Prisma.CricketPlayerProfileUpdateInput = {};

        if (roleId !== null && (!profile || profile.roleId === null)) {
          fill.role = { connect: { id: roleId } };
          update.role = { connect: { id: roleId } };
        }
        if (jerseyNumber !== null && (!profile || profile.jerseyNumber === null)) {
          fill.jerseyNumber = jerseyNumber;
          update.jerseyNumber = jerseyNumber;
        }
        if (jerseySize !== null && (!profile || profile.jerseySize === null)) {
          fill.jerseySize = jerseySize;
          update.jerseySize = jerseySize;
        }

        const hasUpdates = Object.keys(update).length > 0;
        if (hasUpdates) {
          if (!profile) {
            await tx.cricketPlayerProfile.create({ data: fill });
          } else if (!profile.isDeleted) {
            await tx.cricketPlayerProfile.update({ where: { userId: playerIdRaw }, data: update });
          }
        }
      }

      return tournamentPlayer;
    });

    res.status(201).json({ message: "Player added to tournament successfully", data: record });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e) {
      const code = (e as Error & { statusCode: number }).statusCode;
      if (code === 404) { res.status(404).json({ error: e.message }); return; }
      if (code === 400) { res.status(400).json({ error: e.message }); return; }
      if (code === 409) { res.status(409).json({ error: e.message }); return; }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced id does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to add player" });
  }
}

export async function updateTournamentPlayer(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }

  const {
    teamId: teamIdRaw,
    roleId: roleIdRaw,
    bidPrice: bidPriceRaw,
    jerseyNumber: jerseyNumberRaw,
    jerseySize: jerseySizeRaw,
  } = req.body ?? {};

  const data: Prisma.TournamentPlayerUpdateInput = {};

  if (teamIdRaw !== undefined) {
    if (teamIdRaw === null) {
      data.team = { disconnect: true };
    } else {
      if (typeof teamIdRaw !== "string" || !isUuid(teamIdRaw)) {
        res.status(400).json({ error: "teamId must be a valid UUID or null" });
        return;
      }
      data.team = { connect: { id: teamIdRaw } };
    }
  }

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

  if (bidPriceRaw !== undefined) {
    if (bidPriceRaw === null) {
      data.bidPrice = null;
    } else {
      if (typeof bidPriceRaw !== "number" || !Number.isInteger(bidPriceRaw) || bidPriceRaw < 0) {
        res.status(400).json({ error: "bidPrice must be a non-negative integer or null" });
        return;
      }
      data.bidPrice = bidPriceRaw;
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
    const record = await prisma.$transaction(async (tx) => {
      const existing = await tx.tournamentPlayer.findUnique({
        where: { id },
        select: { isDeleted: true, tournamentId: true },
      });
      if (!existing || existing.isDeleted || existing.tournamentId !== tournamentId) {
        throw Object.assign(new Error("Player not found in this tournament"), { statusCode: 404 });
      }

      if (teamIdRaw !== null && teamIdRaw !== undefined) {
        const team = await tx.team.findUnique({
          where: { id: teamIdRaw },
          select: { id: true, isDeleted: true, tournamentId: true },
        });
        if (!team || team.isDeleted || team.tournamentId !== tournamentId) {
          throw Object.assign(new Error("Team not found in this tournament"), { statusCode: 400 });
        }
      }

      if (roleIdRaw !== null && roleIdRaw !== undefined) {
        const role = await tx.cricketRole.findUnique({ where: { id: roleIdRaw }, select: { id: true } });
        if (!role) throw Object.assign(new Error("Cricket role not found"), { statusCode: 400 });
      }

      return tx.tournamentPlayer.update({ where: { id }, data, include: tournamentPlayerInclude });
    });

    res.status(200).json({ message: "Player updated successfully", data: record });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e) {
      const code = (e as Error & { statusCode: number }).statusCode;
      if (code === 404) { res.status(404).json({ error: e.message }); return; }
      if (code === 400) { res.status(400).json({ error: e.message }); return; }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "A referenced id does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update player" });
  }
}

export async function removeTournamentPlayer(req: Request, res: Response): Promise<void> {
  const tournamentId = getTournamentId(req);
  if (!tournamentId) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }

  try {
    const record = await prisma.tournamentPlayer.findUnique({
      where: { id },
      select: { id: true, isDeleted: true, tournamentId: true, playerId: true },
    });
    if (!record || record.isDeleted || record.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Player not found in this tournament" });
      return;
    }

    await prisma.$transaction([
      prisma.tournamentPlayer.update({ where: { id }, data: { isDeleted: true } }),
      prisma.team.updateMany({
        where: { tournamentId, captainId: record.playerId, isDeleted: false },
        data: { captainId: null },
      }),
      prisma.team.updateMany({
        where: { tournamentId, viceCaptainId: record.playerId, isDeleted: false },
        data: { viceCaptainId: null },
      }),
    ]);

    res.status(200).json({ message: "Player removed from tournament successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to remove player" });
  }
}
