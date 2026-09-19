import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedSecret = process.env.OPERATOR_SECRET;

  // If no secret is configured or it is too short, deny all operator access.
  // OPERATOR_SECRET must be at least 32 characters.
  if (!expectedSecret || expectedSecret.length < 32) {
    res.status(503).json({ error: "Set OPERATOR_SECRET to at least 32 characters in this Render service, then redeploy." });
    return;
  }

  const authHeader = req.headers["authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    res.status(403).end();
    return;
  }

  const incoming = authHeader.slice("Bearer ".length);

  // Hash both sides to ensure equal-length Buffers and prevent length-oracle attacks.
  const incomingHash = sha256(incoming);
  const expectedHash = sha256(expectedSecret);

  if (!timingSafeEqual(incomingHash, expectedHash)) {
    res.status(403).end();
    return;
  }

  next();
}
