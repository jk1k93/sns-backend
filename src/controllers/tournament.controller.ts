import type { Request, Response } from "express";
import { Prisma, TournamentStatus } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { haversineKm } from "../helpers/coordinate.helper.js";
import { parseDate } from "../helpers/date.helper.js";
import { isUuid, paramId } from "../helpers/query.helper.js";

const tournamentInclude = {
  venue: { include: { city: true } },
  organiser: { select: { id: true, name: true, phoneNumber: true, email: true } },
  sport: true,
  contacts: { where: { isDeleted: false }, include: { user: { select: { id: true, name: true, phoneNumber: true, email: true } } } },
  cricketConfig: { where: { isDeleted: false } },
} as const;

type ValidatedContact =
  | { kind: "userId"; userId: string }
  | { kind: "details"; name: string; phone: string };

async function validateContacts(
  raw: unknown[],
): Promise<{ validated: ValidatedContact[] } | { error: string }> {
  const validated: ValidatedContact[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: "Each contact must be an object" };
    }
    const obj = item as Record<string, unknown>;

    if ("userId" in obj) {
      if (typeof obj.userId !== "string" || !isUuid(obj.userId)) {
        return { error: `contact.userId "${obj.userId}" is not a valid UUID` };
      }
      validated.push({ kind: "userId", userId: obj.userId });
    } else if ("name" in obj || "phone" in obj) {
      if (typeof obj.name !== "string" || !obj.name.trim()) {
        return { error: "contact.name must be a non-empty string" };
      }
      if (typeof obj.phone !== "string" || !obj.phone.trim()) {
        return { error: "contact.phone must be a non-empty string" };
      }
      validated.push({ kind: "details", name: obj.name.trim(), phone: obj.phone.trim() });
    } else {
      return { error: 'Each contact must have either "userId" or "name" and "phone"' };
    }
  }

  const userIdContacts = validated.filter((c): c is Extract<ValidatedContact, { kind: "userId" }> => c.kind === "userId");
  if (userIdContacts.length > 0) {
    const ids = userIdContacts.map((c) => c.userId);
    const existingUsers = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (existingUsers.length !== ids.length) {
      const foundIds = new Set(existingUsers.map((u) => u.id));
      const missingIds = ids.filter((id) => !foundIds.has(id));
      return { error: `The following userIds do not exist: ${missingIds.join(", ")}` };
    }
  }

  return { validated };
}

async function resolveContactIdsInTx(
  validated: ValidatedContact[],
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const resolvedIds: string[] = [];
  for (const contact of validated) {
    if (contact.kind === "userId") {
      resolvedIds.push(contact.userId);
    } else {
      const user = await tx.user.upsert({
        where: { phoneNumber: contact.phone },
        update: {},
        create: { name: contact.name, phoneNumber: contact.phone },
        select: { id: true },
      });
      resolvedIds.push(user.id);
    }
  }
  return [...new Set(resolvedIds)];
}

export async function listTournaments(req: Request, res: Response): Promise<void> {
  const { lat: latRaw, lng: lngRaw, sportId } = req.query;

  if (typeof sportId !== "string" || !isUuid(sportId)) {
    res.status(400).json({ error: "sportId is required and must be a valid UUID" });
    return;
  }

  let venueIdFilter: string[] | undefined;

  if (latRaw !== undefined || lngRaw !== undefined) {
    if (typeof latRaw !== "string" || typeof lngRaw !== "string") {
      res.status(400).json({ error: "Both lat and lng query params are required for geo-filtering" });
      return;
    }
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      res.status(400).json({ error: "lat must be a valid number between -90 and 90" });
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      res.status(400).json({ error: "lng must be a valid number between -180 and 180" });
      return;
    }

    const venues = await prisma.venue.findMany({
      where: { city: { latitude: { not: null }, longitude: { not: null } } },
      select: { id: true, city: { select: { latitude: true, longitude: true } } },
    });

    venueIdFilter = venues
      .filter((v) => haversineKm(lat, lng, v.city.latitude!, v.city.longitude!) <= 100)
      .map((v) => v.id);
  }

  try {
    const tournaments = await prisma.tournament.findMany({
      where: {
        isDeleted: false,
        sportId,
        ...(venueIdFilter !== undefined ? { venueId: { in: venueIdFilter } } : {}),
      },
      include: tournamentInclude,
      orderBy: { tournamentStartDate: "asc" },
    });
    res.status(200).json({ message: "Tournaments fetched successfully", data: tournaments });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch tournaments" });
  }
}

export async function getTournament(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const tournament = await prisma.tournament.findUnique({ where: { id, isDeleted: false }, include: tournamentInclude });
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    const userId = req.auth!.userId;
    const canUpdate =
      tournament.organiserId === userId ||
      tournament.contacts.some((c) => c.userId === userId);

    res.status(200).json({ message: "Tournament fetched successfully", data: { tournament, metaData: { canUpdate } } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch tournament" });
  }
}

export async function createTournament(req: Request, res: Response): Promise<void> {
  const organiserId = req.auth!.userId;

  const {
    name: nameRaw,
    venueId,
    sportId,
    tournamentStartDate,
    tournamentEndDate,
    registrationStartDate,
    registrationEndDate,
    description,
    status,
    contacts,
  } = req.body ?? {};

  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof venueId !== "string" || !isUuid(venueId)) {
    res.status(400).json({ error: "venueId must be a valid UUID" });
    return;
  }
  if (typeof sportId !== "string" || !isUuid(sportId)) {
    res.status(400).json({ error: "sportId must be a valid UUID" });
    return;
  }

  let startValue: Date | undefined;
  let endValue: Date | undefined;

  if (tournamentStartDate !== undefined) {
    const parsed = parseDate(tournamentStartDate, "tournamentStartDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    startValue = parsed.value;
  }

  if (tournamentEndDate !== undefined) {
    const parsed = parseDate(tournamentEndDate, "tournamentEndDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    endValue = parsed.value;
  }

  if (startValue && endValue && startValue > endValue) {
    res.status(400).json({ error: "tournamentStartDate must be before tournamentEndDate" });
    return;
  }

  let regStartValue: Date | undefined;
  let regEndValue: Date | undefined;

  if (registrationStartDate !== undefined) {
    const parsed = parseDate(registrationStartDate, "registrationStartDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    regStartValue = parsed.value;
  }

  if (registrationEndDate !== undefined) {
    const parsed = parseDate(registrationEndDate, "registrationEndDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    regEndValue = parsed.value;
  }

  if (regStartValue && regEndValue && regStartValue > regEndValue) {
    res.status(400).json({ error: "registrationStartDate must be before registrationEndDate" });
    return;
  }

  const validStatuses = Object.values(TournamentStatus);
  if (status !== undefined && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const descriptionValue =
    typeof description === "string" && description.trim() ? description.trim() : null;

  let validatedContacts: ValidatedContact[] = [];
  if (contacts !== undefined) {
    if (!Array.isArray(contacts)) {
      res.status(400).json({ error: "contacts must be an array" });
      return;
    }
    const result = await validateContacts(contacts);
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    validatedContacts = result.validated;
  }

  try {
    const tournament = await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.findUnique({ where: { id: venueId }, select: { id: true } });
      if (!venue) throw Object.assign(new Error("Venue not found"), { statusCode: 400 });

      const contactIds = await resolveContactIdsInTx(validatedContacts, tx);

      return tx.tournament.create({
        data: {
          name: nameRaw.trim(),
          venueId,
          sportId,
          organiserId,
          tournamentStartDate: startValue ?? null,
          tournamentEndDate: endValue ?? null,
          registrationStartDate: regStartValue ?? null,
          registrationEndDate: regEndValue ?? null,
          description: descriptionValue,
          ...(status ? { status } : {}),
          ...(contactIds.length > 0
            ? { contacts: { createMany: { data: contactIds.map((userId) => ({ userId })) } } }
            : {}),
        },
        include: tournamentInclude,
      });
    });

    res.status(201).json({ message: "Tournament created successfully", data: tournament });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e && e.statusCode === 400) {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      res.status(400).json({ error: "sportId does not exist" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create tournament" });
  }
}

export async function updateTournament(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  console.log(`[updateTournament] request received for tournament id: ${req.body.contacts}`);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const {
    name: nameRaw,
    venueId,
    tournamentStartDate,
    tournamentEndDate,
    registrationStartDate,
    registrationEndDate,
    description,
    status,
    contacts,
  } = req.body ?? {};

  const data: Prisma.TournamentUpdateInput = {};

  if (nameRaw !== undefined) {
    if (typeof nameRaw !== "string" || !nameRaw.trim()) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    data.name = nameRaw.trim();
  }

  if (venueId !== undefined) {
    if (typeof venueId !== "string" || !isUuid(venueId)) {
      res.status(400).json({ error: "venueId must be a valid UUID" });
      return;
    }
    data.venue = { connect: { id: venueId } };
  }

  let parsedTournamentStart: Date | undefined;
  let parsedTournamentEnd: Date | undefined;

  if (tournamentStartDate !== undefined) {
    const parsed = parseDate(tournamentStartDate, "tournamentStartDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    parsedTournamentStart = parsed.value;
    data.tournamentStartDate = parsed.value;
  }

  if (tournamentEndDate !== undefined) {
    const parsed = parseDate(tournamentEndDate, "tournamentEndDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    parsedTournamentEnd = parsed.value;
    data.tournamentEndDate = parsed.value;
  }

  if (parsedTournamentStart && parsedTournamentEnd && parsedTournamentStart > parsedTournamentEnd) {
    res.status(400).json({ error: "tournamentStartDate must be before tournamentEndDate" });
    return;
  }

  let parsedRegStart: Date | undefined;
  let parsedRegEnd: Date | undefined;

  if (registrationStartDate !== undefined) {
    const parsed = parseDate(registrationStartDate, "registrationStartDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    parsedRegStart = parsed.value;
    data.registrationStartDate = parsed.value;
  }

  if (registrationEndDate !== undefined) {
    const parsed = parseDate(registrationEndDate, "registrationEndDate");
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
    parsedRegEnd = parsed.value;
    data.registrationEndDate = parsed.value;
  }

  if (parsedRegStart && parsedRegEnd && parsedRegStart > parsedRegEnd) {
    res.status(400).json({ error: "registrationStartDate must be before registrationEndDate" });
    return;
  }

  if (description !== undefined) {
    data.description =
      typeof description === "string" && description.trim() ? description.trim() : null;
  }

  if (status !== undefined) {
    const validStatuses = Object.values(TournamentStatus);
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
      return;
    }
    data.status = status;
  }

  let validatedContacts: ValidatedContact[] | undefined;
  if (contacts !== undefined) {
    if (!Array.isArray(contacts)) {
      res.status(400).json({ error: "contacts must be an array" });
      return;
    }
    const result = await validateContacts(contacts);
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    validatedContacts = result.validated;
  }

  try {
    if (venueId !== undefined) {
      const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } });
      if (!venue) {
        res.status(400).json({ error: "Venue not found" });
        return;
      }
    }

    const tournament = await prisma.$transaction(async (tx) => {
      const existing = await tx.tournament.findUnique({ where: { id }, select: { isDeleted: true } });
      if (!existing || existing.isDeleted) throw Object.assign(new Error("Tournament not found"), { statusCode: 404 });

      if (validatedContacts !== undefined) {
        const contactIds = await resolveContactIdsInTx(validatedContacts, tx);
        await tx.tournamentContact.updateMany({ where: { tournamentId: id }, data: { isDeleted: true } });
        for (const userId of contactIds) {
          await tx.tournamentContact.upsert({
            where: { tournamentId_userId: { tournamentId: id, userId } },
            update: { isDeleted: false },
            create: { tournamentId: id, userId },
          });
        }
      }
      return tx.tournament.update({ where: { id }, data, include: tournamentInclude });
    });

    res.status(200).json({ message: "Tournament updated successfully", data: tournament });
  } catch (e) {
    if (e instanceof Error && "statusCode" in e && e.statusCode === 404) {
      res.status(404).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update tournament" });
  }
}

export async function deleteTournament(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const tournament = await prisma.tournament.findUnique({ where: { id }, select: { id: true, isDeleted: true } });
    if (!tournament || tournament.isDeleted) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    await prisma.$transaction([
      prisma.tournament.update({ where: { id }, data: { isDeleted: true } }),
      prisma.cricketConfig.updateMany({ where: { tournamentId: id, isDeleted: false }, data: { isDeleted: true } }),
    ]);
    res.status(200).json({ message: "Tournament deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete tournament" });
  }
}
