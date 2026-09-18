import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { IntegrationConfigurationError } from "../puente/integrations";
import type { PaymentTerms } from "../puente/integrations";
import { InsufficientBudgetError } from "../puente/budget-service";
import * as PurchaseService from "../puente/purchase-service";
import { PurchaseServiceError } from "../puente/purchase-service";

// Lazy DB accessor — avoids crashing at module load when DATABASE_URL is absent.
let _dbModule: typeof import("@workspace/db") | undefined;
function getDbModule(): typeof import("@workspace/db") {
  if (!_dbModule) {
    // Dynamic require is intentional: defers DATABASE_URL validation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _dbModule = require("@workspace/db") as typeof import("@workspace/db");
  }
  return _dbModule;
}

const router = Router();

function problem(res: Response, code: number, message: string, extra?: object) {
  return res.status(code).json({ error: message, ...extra });
}

// ---------------------------------------------------------------------------
// POST /api/reservations/:id/purchase — x402 purchase flow
// ---------------------------------------------------------------------------

router.post("/reservations/:id/purchase", async (req: Request, res: Response) => {
  // Buyer session check.
  const buyerId = req.headers["x-buyer-id"];
  if (typeof buyerId !== "string" || !buyerId) {
    problem(res, 401, "x-buyer-id header is required.");
    return;
  }

  // Validate Idempotency-Key header.
  const idempotencyKey = req.headers["idempotency-key"];
  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey ||
    idempotencyKey.length > 200
  ) {
    problem(res, 400, "Idempotency-Key header is required and must be ≤ 200 characters.");
    return;
  }

  // Compute request hash.
  const requestHash = createHash("sha256")
    .update(JSON.stringify(req.body))
    .digest("hex");

  const reservationId = String(req.params.id);
  const xPayment = req.headers["x-payment"];

  try {
    const { db, reservations } = getDbModule();

    // Load reservation.
    const resRows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));

    const reservation = resRows[0];
    if (!reservation) {
      problem(res, 404, "Reservation not found.");
      return;
    }

    const terms = reservation.terms as PaymentTerms;

    // -----------------------------------------------------------------------
    // First call — no X-Payment header: issue 402 requirement
    // -----------------------------------------------------------------------
    if (!xPayment) {
      const result = await PurchaseService.issueRequirement(
        reservationId,
        buyerId,
        idempotencyKey,
        requestHash,
        db,
      );

      if ("alreadyConfirmed" in result && result.alreadyConfirmed) {
        res.status(202).json({ message: "Purchase already confirmed." });
        return;
      }

      res.set("WWW-Authenticate", "x402");
      res.status(402).json({ requirement: result.requirement, sourceMode: result.sourceMode });
      return;
    }

    // -----------------------------------------------------------------------
    // Second call — X-Payment header present: execute purchase
    // -----------------------------------------------------------------------
    const authorizationPayload = String(xPayment);

    const result = await PurchaseService.executePurchase(
      authorizationPayload,
      terms,
      reservationId,
      buyerId,
      idempotencyKey,
      requestHash,
      db,
    );

    if (result.status === 202) {
      res.status(202).json(result);
    } else {
      // 402 from payment failure
      res.status(402).json({ error: (result as { reason: string }).reason });
    }
  } catch (err) {
    if (err instanceof PurchaseServiceError) {
      if (err.status === 409) {
        problem(res, 409, "Idempotency key reused with different request");
        return;
      }
      if (err.status === 402) {
        problem(res, 402, err.reason ?? err.message);
        return;
      }
    }

    if (err instanceof IntegrationConfigurationError) {
      problem(res, 503, err.message);
      return;
    }

    if (err instanceof InsufficientBudgetError) {
      problem(res, 402, "Insufficient budget");
      return;
    }

    const e = err as { status?: number };
    if (e.status === 404) {
      problem(res, 404, "Reservation not found.");
      return;
    }

    problem(res, 500, "Could not process purchase.");
  }
});

export default router;
