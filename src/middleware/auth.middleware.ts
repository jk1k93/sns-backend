import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload & {
      sub?: string;
    };
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.auth = { userId };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
