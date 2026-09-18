// Durable reconciliation job worker.
// Polls `jobs` table every 10 seconds for RECONCILE_PURCHASE jobs in READY state.

import { eq, and, lte, sql } from "drizzle-orm";
import type { db as _dbInstance } from "@workspace/db";
import { restore } from "./budget-service";
import { UnsupportedStellarX402Adapter, StellarX402Adapter } from "./integrations";
import type { X402Port } from "./integrations";
import { logger } from "../lib/logger";

// Derive DB type from the type-only import — no runtime database initialization.
type DB = typeof _dbInstance;

// Lazy accessor for schema — defers DATABASE_URL check to first request.
let _dbMod: typeof import("@workspace/db") | undefined;
function getDb(): typeof import("@workspace/db") {
  if (!_dbMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _dbMod = require("@workspace/db") as typeof import("@workspace/db");
  }
  return _dbMod;
}

// Module-level x402 adapter instance — uses StellarX402Adapter when env vars
// are present, falls back to UnsupportedStellarX402Adapter (throws/503) otherwise.
const x402Adapter: X402Port = StellarX402Adapter.getInstance();

const POLL_INTERVAL_MS = 10_000;
const LEASE_DURATION_MS = 60_000;
const REQUEUE_DELAY_MS = 30_000;
const BATCH_LIMIT = 5;

// ---------------------------------------------------------------------------
// processJob — reconcile a single leased job
// ---------------------------------------------------------------------------

async function processJob(
  job: { id: string; payload: unknown; attempts: number },
  db: DB,
): Promise<void> {
  const { purchases, settlements, reservations, taskIntents, jobs, auditEvents } = getDb();

  const payload = job.payload as { purchaseId?: string; providerReference?: string | null };
  const purchaseId = payload.purchaseId;
  const providerReference = payload.providerReference;

  if (!purchaseId) {
    logger.warn({ jobId: job.id }, "RECONCILE_PURCHASE job missing purchaseId — marking DONE");
    await db
      .update(jobs)
      .set({ status: "DONE" })
      .where(eq(jobs.id, job.id));
    return;
  }

  if (!providerReference) {
    // No provider reference yet — re-queue and wait.
    await db
      .update(jobs)
      .set({
        status: "READY",
        runAfter: new Date(Date.now() + REQUEUE_DELAY_MS),
        attempts: job.attempts + 1,
      })
      .where(eq(jobs.id, job.id));
    return;
  }

  // Call X402Port.lookup — UnsupportedStellarX402Adapter will throw
  // IntegrationConfigurationError; we catch it below and re-queue.
  const result = await x402Adapter.lookup(providerReference);

  if (result.status === "CONFIRMED") {
    // Load purchase row.
    const purchaseRows = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId));
    const purchase = purchaseRows[0];
    if (!purchase) {
      logger.warn({ purchaseId }, "Purchase not found during reconciliation — marking DONE");
      await db.update(jobs).set({ status: "DONE" }).where(eq(jobs.id, job.id));
      return;
    }

    // Insert settlement with ON CONFLICT DO NOTHING.
    await db
      .insert(settlements)
      .values({
        purchaseId,
        providerReference,
        network: purchase.network,
        recipient: purchase.recipient,
        observedBaseUnits: purchase.amountBaseUnits,
        status: "CONFIRMED",
        confirmedAt: new Date(),
      })
      .onConflictDoNothing();

    // Update purchase status.
    await db
      .update(purchases)
      .set({ status: "CONFIRMED" })
      .where(eq(purchases.id, purchaseId));

    // Activate task if reservation found.
    const resRows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, purchase.reservationId));
    const reservation = resRows[0];
    if (reservation) {
      await db
        .update(taskIntents)
        .set({ status: "IN_PROGRESS" })
        .where(
          and(
            eq(taskIntents.id, reservation.taskId),
            eq(taskIntents.status, "PAYMENT_PENDING"),
          ),
        );
    }

    // Write audit event.
    await db.insert(auditEvents).values({
      aggregateId: purchaseId,
      event: "PURCHASE_CONFIRMED",
      actor: purchase.buyerId,
      sourceMode: "TESTNET",
      metadata: { purchaseId, providerReference, reconciledAt: new Date().toISOString() },
    });

    // Mark job done.
    await db.update(jobs).set({ status: "DONE" }).where(eq(jobs.id, job.id));
    return;
  }

  if (result.status === "FAILED") {
    // Load purchase row.
    const purchaseRows = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId));
    const purchase = purchaseRows[0];
    if (!purchase) {
      logger.warn({ purchaseId }, "Purchase not found during reconciliation (FAILED) — marking DONE");
      await db.update(jobs).set({ status: "DONE" }).where(eq(jobs.id, job.id));
      return;
    }

    // Update purchase status.
    await db
      .update(purchases)
      .set({ status: "FAILED" })
      .where(eq(purchases.id, purchaseId));

    // Restore budget.
    if (purchase.debitedBaseUnits !== null) {
      await restore(
        purchase.buyerId,
        purchase.debitedBaseUnits.toString(),
        purchaseId,
        db,
      );
    }

    // Write audit event.
    await db.insert(auditEvents).values({
      aggregateId: purchaseId,
      event: "PURCHASE_FAILED",
      actor: purchase.buyerId,
      sourceMode: "TESTNET",
      metadata: { purchaseId, providerReference, reconciledAt: new Date().toISOString() },
    });

    // Mark job done.
    await db.update(jobs).set({ status: "DONE" }).where(eq(jobs.id, job.id));
    return;
  }

  // UNKNOWN — re-queue after delay.
  await db
    .update(jobs)
    .set({
      status: "READY",
      runAfter: new Date(Date.now() + REQUEUE_DELAY_MS),
      attempts: job.attempts + 1,
    })
    .where(eq(jobs.id, job.id));
}

// ---------------------------------------------------------------------------
// poll — one tick of the polling loop
// ---------------------------------------------------------------------------

async function poll(db: DB): Promise<void> {
  const { jobs } = getDb();

  // Find READY jobs due for processing.
  const readyJobs = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "RECONCILE_PURCHASE"),
        eq(jobs.status, "READY"),
        lte(jobs.runAfter, new Date()),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const job of readyJobs) {
    // Attempt to acquire lease — use returning() to confirm.
    const leased = await db
      .update(jobs)
      .set({
        status: "LEASED",
        leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "READY")))
      .returning();

    if (leased.length === 0) {
      // Another worker won the lease — skip.
      continue;
    }

    try {
      await processJob(job, db);
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Unexpected error reconciling job — re-queuing");
      // Re-queue on unexpected error.
      await db
        .update(jobs)
        .set({
          status: "READY",
          runAfter: new Date(Date.now() + REQUEUE_DELAY_MS),
          attempts: sql`${jobs.attempts} + 1`,
        })
        .where(eq(jobs.id, job.id));
    }
  }
}

// ---------------------------------------------------------------------------
// startJobWorker
// ---------------------------------------------------------------------------

/**
 * Start the durable reconciliation job worker.
 * Returns the interval handle so callers can clear it on shutdown if needed.
 */
export function startJobWorker(db: DB): NodeJS.Timeout {
  logger.info("Job worker started — polling every 10 seconds for RECONCILE_PURCHASE jobs");

  return setInterval(() => {
    poll(db).catch((err) => {
      logger.error({ err }, "Job worker poll iteration failed");
    });
  }, POLL_INTERVAL_MS);
}
