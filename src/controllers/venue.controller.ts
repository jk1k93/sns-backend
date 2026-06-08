import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { parseCoordinate } from "../helpers/coordinate.helper.js";
import type { CoordinateInput } from "../helpers/coordinate.helper.js";
import { queryString } from "../helpers/query.helper.js";

const venueInclude = { city: true } as const;

type CityInput = {
  placeId: string;
  name: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
};

type VenuePayload = {
  name: string;
  address?: string | null | "";
  latitude?: CoordinateInput;
  longitude?: CoordinateInput;
};

export async function searchVenues(req: Request, res: Response): Promise<void> {
  const qRaw = queryString(req.query.q);
  const term = qRaw?.trim() ?? "";

  const where: Prisma.VenueWhereInput =
    term.length > 0
      ? {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { address: { contains: term, mode: "insensitive" } },
          { city: { name: { contains: term, mode: "insensitive" } } },
          { city: { state: { contains: term, mode: "insensitive" } } },
          { city: { country: { contains: term, mode: "insensitive" } } },
        ],
      }
      : {};

  try {
    const venues = await prisma.venue.findMany({
      where,
      include: venueInclude,
      orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
    });
    res.status(200).json({
      message: "Venues fetched successfully",
      data: venues,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to search venues" });
  }
}

export async function createVenue(req: Request, res: Response): Promise<void> {
  const venuePayload: Partial<VenuePayload> | undefined =
    req.body?.venue && typeof req.body.venue === "object"
      ? (req.body.venue as Partial<VenuePayload>)
      : undefined;
  const cityPayload: Partial<CityInput> | undefined =
    req.body?.city && typeof req.body.city === "object"
      ? (req.body.city as Partial<CityInput>)
      : undefined;

  const nameRaw = venuePayload?.name;
  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  if (!cityPayload) {
    res.status(400).json({ error: "city details are required" });
    return;
  }

  const placeIdRaw = cityPayload.placeId;
  if (typeof placeIdRaw !== "string" || !placeIdRaw.trim()) {
    res.status(400).json({ error: "city.placeId is required" });
    return;
  }
  const cityNameRaw = cityPayload.name;
  if (typeof cityNameRaw !== "string" || !cityNameRaw.trim()) {
    res.status(400).json({ error: "city.name is required" });
    return;
  }
  const stateRaw = cityPayload.state;
  if (typeof stateRaw !== "string" || !stateRaw.trim()) {
    res.status(400).json({ error: "city.state is required" });
    return;
  }
  const countryRaw = cityPayload.country;
  if (typeof countryRaw !== "string" || !countryRaw.trim()) {
    res.status(400).json({ error: "city.country is required" });
    return;
  }
  const cityLatitudeParsed = parseCoordinate(cityPayload.latitude, "latitude");
  if (
    cityLatitudeParsed.error ||
    cityLatitudeParsed.value === undefined ||
    cityLatitudeParsed.value === null
  ) {
    res.status(400).json({ error: "city.latitude is required and must be a valid number" });
    return;
  }
  const cityLongitudeParsed = parseCoordinate(cityPayload.longitude, "longitude");
  if (
    cityLongitudeParsed.error ||
    cityLongitudeParsed.value === undefined ||
    cityLongitudeParsed.value === null
  ) {
    res.status(400).json({ error: "city.longitude is required and must be a valid number" });
    return;
  }

  let address: string | null | undefined = undefined;
  if (venuePayload && "address" in venuePayload) {
    const a = venuePayload.address;
    if (a === null || a === "") {
      address = null;
    } else if (typeof a === "string") {
      const t = a.trim();
      address = t.length > 0 ? t : null;
    } else {
      res.status(400).json({ error: "address must be a string or null" });
      return;
    }
  }

  const venueLatitudeParsed = parseCoordinate(venuePayload?.latitude, "latitude");
  if (venueLatitudeParsed.error) {
    res.status(400).json({ error: venueLatitudeParsed.error });
    return;
  }
  const latitude = venueLatitudeParsed.value;

  const venueLongitudeParsed = parseCoordinate(venuePayload?.longitude, "longitude");
  if (venueLongitudeParsed.error) {
    res.status(400).json({ error: venueLongitudeParsed.error });
    return;
  }
  const longitude = venueLongitudeParsed.value;

  const placeId = placeIdRaw.trim();

  try {
    const venue = await prisma.$transaction(async (tx) => {
      const city = await tx.city.upsert({
        where: { placeId },
        update: {},
        create: {
          placeId,
          name: cityNameRaw.trim(),
          state: stateRaw.trim(),
          country: countryRaw.trim(),
          latitude: cityLatitudeParsed.value,
          longitude: cityLongitudeParsed.value,
        },
      });

      const venueData: Prisma.VenueCreateInput = {
        name: nameRaw.trim(),
        city: { connect: { id: city.id } },
      };
      if (address !== undefined) venueData.address = address;
      if (latitude !== undefined) venueData.latitude = latitude;
      if (longitude !== undefined) venueData.longitude = longitude;

      return tx.venue.create({ data: venueData, include: venueInclude });
    });

    res.status(201).json({ message: "Venue created successfully", data: venue });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create venue" });
  }
}
