/**
 * payout.ts
 *
 * Worker payout routes — BOB cash-out via FixtureRampAdapter (always FIXTURE/SIMULATED).
 *
 * POST /api/payout-quotes  — fetch a mock payout quote for a confirmed task
 * POST /api/payouts        — authorise a payout using a previously obtained quote
 */

import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { FixtureRampAdapter } from "../puente/integrations";
import { assertSourceMode } from "../lib/source-mode-guard";

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

// Module-level singleton — FixtureRampAdapter never calls external services.
const rampAdapter = new FixtureRampAdapter();

const router = Router();

function problem(res: Response, code: number, message: string, extra?: object) {
  return res.status(code).json({ error: message, ...extra });
}

// ---------------------------------------------------------------------------
// POST /api/payout-quotes — worker requests a BOB payout quote
// ---------------------------------------------------------------------------

router.post("/payout-quotes", async (req: Request, res: Response) => {
  const workerId = req.headers["x-worker-id"];
  if (typeof workerId !== "string" || !workerId) {
    problem(res, 401, "x-worker-id header is required.");
    return;
  }

  const { taskId, workerWalletAddress } = req.body as {
    taskId?: string;
    workerWalletAddress?: string;
  };

  if (!taskId || typeof taskId !== "string") {
    problem(res, 400, "taskId is required.");
    return;
  }

  if (!workerWalletAddress || typeof workerWalletAddress !== "string") {
    problem(res, 422, "Worker wallet address is required");
    return;
  }

  try {
    const { db, taskIntents, reservations } = getDbModule();

    // Load the task.
    const taskRows = await db
      .select()
      .from(taskIntents)
      .where(eq(taskIntents.id, taskId));

    const task = taskRows[0];
    if (!task) {
      problem(res, 404, "Task not found.");
      return;
    }

    if (task.status !== "CONFIRMED") {
      problem(res, 409, "Task is not in CONFIRMED state", { currentStatus: task.status });
      return;
    }

    // Load reservation to get terms (assetBaseUnits).
    const resRows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.taskId, taskId));

    const reservation = resRows[0];
    if (!reservation) {
      problem(res, 404, "Reservation not found for task.");
      return;
    }

    const terms = reservation.terms as { amountBaseUnits?: string };
    const assetBaseUnits = terms.amountBaseUnits ?? "0";

    // Call FixtureRampAdapter.quote.
    let result: Awaited<ReturnType<typeof rampAdapter.quote>>;
    try {
      result = await rampAdapter.quote({ workerWalletAddress, assetBaseUnits });
    } catch (e) {
      problem(res, 503, e instanceof Error ? e.message : "Could not fetch payout quote.");
      return;
    }

    // Validate sourceMode — return 502 if missing or unrecognised.
    try {
      assertSourceMode(result);
    } catch (e) {
      problem(res, 502, e instanceof Error ? e.message : "Adapter response missing sourceMode.");
      return;
    }

    res.status(200).json(result);
  } catch {
    problem(res, 500, "Could not process payout quote request.");
  }
});

// ---------------------------------------------------------------------------
// POST /api/payouts — worker authorises a payout
// ---------------------------------------------------------------------------

router.post("/payouts", async (req: Request, res: Response) => {
  const workerId = req.headers["x-worker-id"];
  if (typeof workerId !== "string" || !workerId) {
    problem(res, 401, "x-worker-id header is required.");
    return;
  }

  const { quoteId, idempotencyKey, workerWalletAddress, quoteExpiresAt } =
    req.body as {
      quoteId?: string;
      idempotencyKey?: string;
      workerWalletAddress?: string;
      quoteExpiresAt?: string;
    };

  if (!quoteId || typeof quoteId !== "string") {
    problem(res, 400, "quoteId is required.");
    return;
  }

  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    problem(res, 400, "idempotencyKey is required.");
    return;
  }

  if (!workerWalletAddress || typeof workerWalletAddress !== "string") {
    problem(res, 400, "workerWalletAddress is required.");
    return;
  }

  // Check quote expiry if the client supplied a quoteExpiresAt timestamp.
  if (quoteExpiresAt) {
    const expiresAt = new Date(quoteExpiresAt);
    if (!isNaN(expiresAt.getTime()) && expiresAt <= new Date()) {
      problem(res, 422, "Quote has expired");
      return;
    }
  }

  try {
    const { db, payoutOrders, auditEvents } = getDbModule();

    // Call FixtureRampAdapter.submitPayout.
    let result: Awaited<ReturnType<typeof rampAdapter.submitPayout>>;
    try {
      result = await rampAdapter.submitPayout({
        quoteId,
        workerWalletAddress,
        idempotencyKey,
      });
    } catch (e) {
      problem(res, 503, e instanceof Error ? e.message : "Could not submit payout.");
      return;
    }

    // Validate sourceMode — return 502 if missing or unrecognised.
    try {
      assertSourceMode(result);
    } catch (e) {
      problem(res, 502, e instanceof Error ? e.message : "Adapter response missing sourceMode.");
      return;
    }

    // Derive expiresAt for storage — use provided value or now (quote already consumed).
    const quoteExpiresAtDate = quoteExpiresAt
      ? new Date(quoteExpiresAt)
      : new Date();

    // INSERT payout_orders row with ON CONFLICT DO NOTHING for idempotency.
    await db
      .insert(payoutOrders)
      .values({
        workerId,
        quoteId,
        quoteExpiresAt: quoteExpiresAtDate,
        assetBaseUnits: BigInt(0), // fixture — no real asset tracked
        bobMinorUnits: BigInt(0),  // fixture — no real BOB tracked
        feeBaseUnits: BigInt(0),   // fixture — no real fee tracked
        providerReference: result.payoutReference,
        sourceMode: "FIXTURE",
        status: "SIMULATED",
        idempotencyKey,
        exchangeRate: "",
        workerWallet: workerWalletAddress,
      })
      .onConflictDoNothing();

    // Write PAYOUT_ORDER_CREATED audit event.
    await db.insert(auditEvents).values({
      aggregateId: result.payoutReference,
      event: "PAYOUT_ORDER_CREATED",
      actor: workerId,
      sourceMode: "FIXTURE",
      metadata: {
        quoteId,
        payoutReference: result.payoutReference,
        observedAt: result.observedAt,
      },
    });

    res.status(200).json({
      payoutReference: result.payoutReference,
      status: result.status,
      sourceMode: result.sourceMode,
      observedAt: result.observedAt,
    });
  } catch {
    problem(res, 500, "Could not process payout.");
  }
});

export default router;
