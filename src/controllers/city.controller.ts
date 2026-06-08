import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";

export async function createCity(req: Request, res: Response): Promise<void> {
  const placeIdRaw = req.body?.placeId;
  if (typeof placeIdRaw !== "string" || !placeIdRaw.trim()) {
    res.status(400).json({ error: "placeId is required" });
    return;
  }
  const placeId = placeIdRaw.trim();

  try {
    const existing = await prisma.city.findUnique({ where: { placeId } });
    if (existing) {
      res.status(200).json({
        message: "City already exists",
        data: existing,
      });
      return;
    }

    const nameRaw = req.body?.name;
    const stateRaw = req.body?.state;
    const countryRaw = req.body?.country;
    if (typeof nameRaw !== "string" || !nameRaw.trim()) {
      res.status(400).json({ error: "name is required when creating a new city" });
      return;
    }
    if (typeof stateRaw !== "string" || !stateRaw.trim()) {
      res.status(400).json({ error: "state is required when creating a new city" });
      return;
    }
    if (typeof countryRaw !== "string" || !countryRaw.trim()) {
      res.status(400).json({ error: "country is required when creating a new city" });
      return;
    }

    let latitude: number | null | undefined = undefined;
    if ("latitude" in req.body) {
      const lat = req.body.latitude;
      if (lat === null || lat === "") {
        latitude = null;
      } else if (typeof lat === "number" && Number.isFinite(lat)) {
        if (lat < -90 || lat > 90) {
          res.status(400).json({ error: "latitude must be between -90 and 90" });
          return;
        }
        latitude = lat;
      } else {
        res.status(400).json({ error: "latitude must be a number or null" });
        return;
      }
    }

    let longitude: number | null | undefined = undefined;
    if ("longitude" in req.body) {
      const lng = req.body.longitude;
      if (lng === null || lng === "") {
        longitude = null;
      } else if (typeof lng === "number" && Number.isFinite(lng)) {
        if (lng < -180 || lng > 180) {
          res.status(400).json({ error: "longitude must be between -180 and 180" });
          return;
        }
        longitude = lng;
      } else {
        res.status(400).json({ error: "longitude must be a number or null" });
        return;
      }
    }

    const name = nameRaw.trim();
    const state = stateRaw.trim();
    const country = countryRaw.trim();

    const data: Prisma.CityCreateInput = {
      name,
      state,
      country,
      placeId,
    };
    if (latitude !== undefined) data.latitude = latitude;
    if (longitude !== undefined) data.longitude = longitude;

    try {
      const city = await prisma.city.create({ data });
      res.status(201).json({
        message: "City created successfully",
        data: city,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await prisma.city.findUnique({ where: { placeId } });
        if (again) {
          res.status(200).json({
            message: "City already exists",
            data: again,
          });
          return;
        }
      }
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create city" });
  }
}
