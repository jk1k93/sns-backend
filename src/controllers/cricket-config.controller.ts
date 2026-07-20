import type { Request, Response } from "express";
import { BallType, GroundType } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isPositiveInt, isUuid, paramId } from "../helpers/query.helper.js";

export async function getCricketConfig(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const config = await prisma.cricketTournamentConfig.findUnique({ where: { tournamentId } });
    if (!config || config.isDeleted) {
      res.status(404).json({ error: "Cricket config not found" });
      return;
    }
    res.status(200).json({ message: "Cricket config fetched successfully", data: config });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch cricket config" });
  }
}

export async function createCricketConfig(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const { groundType, ballType, numberOfTeams, playersPerTeam, auctionBased, auctionPurse, playerBasePrice, oversPerInnings, freeHitEnabled } = req.body ?? {};

  const validGroundTypes = Object.values(GroundType);
  if (!validGroundTypes.includes(groundType)) {
    res.status(400).json({ error: `groundType must be one of: ${validGroundTypes.join(", ")}` });
    return;
  }

  const validBallTypes = Object.values(BallType);
  if (!validBallTypes.includes(ballType)) {
    res.status(400).json({ error: `ballType must be one of: ${validBallTypes.join(", ")}` });
    return;
  }

  if (!isPositiveInt(numberOfTeams)) {
    res.status(400).json({ error: "numberOfTeams must be a positive integer" });
    return;
  }

  if (!isPositiveInt(playersPerTeam)) {
    res.status(400).json({ error: "playersPerTeam must be a positive integer" });
    return;
  }

  if (!isPositiveInt(oversPerInnings)) {
    res.status(400).json({ error: "oversPerInnings must be a positive integer" });
    return;
  }

  if (freeHitEnabled !== undefined && typeof freeHitEnabled !== "boolean") {
    res.status(400).json({ error: "freeHitEnabled must be a boolean" });
    return;
  }
  const freeHitEnabledValue: boolean = freeHitEnabled ?? true;

  if (auctionBased !== undefined && typeof auctionBased !== "boolean") {
    res.status(400).json({ error: "auctionBased must be a boolean" });
    return;
  }

  const auctionBasedValue: boolean = auctionBased ?? false;

  let auctionPurseValue: number | null = null;
  let playerBasePriceValue: number | null = null;

  if (auctionBasedValue) {
    if (auctionPurse !== undefined && auctionPurse !== null) {
      if (!isPositiveInt(auctionPurse)) {
        res.status(400).json({ error: "auctionPurse must be a positive integer" });
        return;
      }
      auctionPurseValue = auctionPurse;
    }

    if (playerBasePrice !== undefined && playerBasePrice !== null) {
      if (!isPositiveInt(playerBasePrice)) {
        res.status(400).json({ error: "playerBasePrice must be a positive integer" });
        return;
      }
      playerBasePriceValue = playerBasePrice;
    }
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

    const existing = await prisma.cricketTournamentConfig.findUnique({ where: { tournamentId } });
    if (existing && !existing.isDeleted) {
      res.status(409).json({ error: "Cricket config already exists for this tournament" });
      return;
    }

    const configData = {
      groundType,
      ballType,
      numberOfTeams,
      playersPerTeam,
      auctionBased: auctionBasedValue,
      auctionPurse: auctionPurseValue,
      playerBasePrice: playerBasePriceValue,
      oversPerInnings,
      freeHitEnabled: freeHitEnabledValue,
    };

    const config = existing
      ? await prisma.cricketTournamentConfig.update({ where: { tournamentId }, data: { ...configData, isDeleted: false } })
      : await prisma.cricketTournamentConfig.create({ data: { tournamentId, ...configData } });

    res.status(201).json({ message: "Cricket config created successfully", data: config });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create cricket config" });
  }
}

export async function updateCricketConfig(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const { groundType, ballType, numberOfTeams, playersPerTeam, auctionBased, auctionPurse, playerBasePrice, oversPerInnings, freeHitEnabled } = req.body ?? {};

  const data: {
    groundType?: GroundType;
    ballType?: BallType;
    numberOfTeams?: number;
    playersPerTeam?: number;
    auctionBased?: boolean;
    auctionPurse?: number | null;
    playerBasePrice?: number | null;
    oversPerInnings?: number;
    freeHitEnabled?: boolean;
  } = {};

  if (groundType !== undefined) {
    const validGroundTypes = Object.values(GroundType);
    if (!validGroundTypes.includes(groundType)) {
      res.status(400).json({ error: `groundType must be one of: ${validGroundTypes.join(", ")}` });
      return;
    }
    data.groundType = groundType;
  }

  if (ballType !== undefined) {
    const validBallTypes = Object.values(BallType);
    if (!validBallTypes.includes(ballType)) {
      res.status(400).json({ error: `ballType must be one of: ${validBallTypes.join(", ")}` });
      return;
    }
    data.ballType = ballType;
  }

  if (numberOfTeams !== undefined) {
    if (!isPositiveInt(numberOfTeams)) {
      res.status(400).json({ error: "numberOfTeams must be a positive integer" });
      return;
    }
    data.numberOfTeams = numberOfTeams;
  }

  if (playersPerTeam !== undefined) {
    if (!isPositiveInt(playersPerTeam)) {
      res.status(400).json({ error: "playersPerTeam must be a positive integer" });
      return;
    }
    data.playersPerTeam = playersPerTeam;
  }

  if (auctionBased !== undefined) {
    if (typeof auctionBased !== "boolean") {
      res.status(400).json({ error: "auctionBased must be a boolean" });
      return;
    }
    data.auctionBased = auctionBased;
    if (!auctionBased) {
      data.auctionPurse = null;
      data.playerBasePrice = null;
    }
  }

  if (oversPerInnings !== undefined) {
    if (!isPositiveInt(oversPerInnings)) {
      res.status(400).json({ error: "oversPerInnings must be a positive integer" });
      return;
    }
    data.oversPerInnings = oversPerInnings;
  }

  if (freeHitEnabled !== undefined) {
    if (typeof freeHitEnabled !== "boolean") {
      res.status(400).json({ error: "freeHitEnabled must be a boolean" });
      return;
    }
    data.freeHitEnabled = freeHitEnabled;
  }

  // Only apply auction-specific fields if auctionBased is not being explicitly set to false
  if (data.auctionBased !== false) {
    if (auctionPurse !== undefined && auctionPurse !== null) {
      if (!isPositiveInt(auctionPurse)) {
        res.status(400).json({ error: "auctionPurse must be a positive integer" });
        return;
      }
      data.auctionPurse = auctionPurse;
    }

    if (playerBasePrice !== undefined && playerBasePrice !== null) {
      if (!isPositiveInt(playerBasePrice)) {
        res.status(400).json({ error: "playerBasePrice must be a positive integer" });
        return;
      }
      data.playerBasePrice = playerBasePrice;
    }
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No fields provided to update" });
    return;
  }

  try {
    const config = await prisma.cricketTournamentConfig.findUnique({ where: { tournamentId } });
    if (!config || config.isDeleted) {
      res.status(404).json({ error: "Cricket config not found" });
      return;
    }

    const updated = await prisma.cricketTournamentConfig.update({ where: { tournamentId }, data });
    res.status(200).json({ message: "Cricket config updated successfully", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update cricket config" });
  }
}

export async function deleteCricketConfig(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const config = await prisma.cricketTournamentConfig.findUnique({ where: { tournamentId } });
    if (!config || config.isDeleted) {
      res.status(404).json({ error: "Cricket config not found" });
      return;
    }

    await prisma.cricketTournamentConfig.update({ where: { tournamentId }, data: { isDeleted: true } });
    res.status(200).json({ message: "Cricket config deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete cricket config" });
  }
}
