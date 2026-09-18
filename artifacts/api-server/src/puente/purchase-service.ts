// Purchase service — manages the Purchase state machine for x402 payments.
// States: CREATED -> VERIFYING -> CONFIRMED | FAILED | UNKNOWN
// UNKNOWN is reconciled by the job worker.

import { eq, and } from "drizzle-orm";
import type { db as _dbInstance } from "@workspace/db";
import { debit, restore, InsufficientBudgetError } from "./budget-service";
import { UnsupportedStellarX402Adapter, StellarX402Adapter } from "./integrations";
import type { X402Port, PaymentTerms } from "./integrations";

// Derive DB type from the type-only import — no runtime database initialization.
type DB = typeof _dbInstance;

// Lazy accessor for schema/db — defers DATABASE_URL check to first request.
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

// ---------------------------------------------------------------------------
// PurchaseServiceError
// ---------------------------------------------------------------------------

export class PurchaseServiceError extends Error {
  status: number;
  reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = "PurchaseServiceError";
    this.status = status;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// issueRequirement
// ---------------------------------------------------------------------------

/**
 * First leg of the x402 flow: issue a 402 payment requirement to the buyer.
 * Idempotency: same key + same hash + CONFIRMED → return alreadyConfirmed.
 */
export async function issueRequirement(
  reservationId: string,
  buyerId: string,
  idempotencyKey: string,
  requestHash: string,
  db: DB,
) {
  const { purchases, reservations } = getDb();

  // Idempotency check.
  const existing = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, buyerId),
        eq(purchases.idempotencyKey, idempotencyKey),
      ),
    );

  if (existing.length > 0) {
    const row = existing[0];
    if (row.requestHash !== requestHash) {
      throw new PurchaseServiceError(
        "Idempotency key reused with different request",
        409,
      );
    }
    if (row.status === "CONFIRMED") {
      return { alreadyConfirmed: true, status: 202 };
    }
  }

  // Load reservation to get terms.
  const resRows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId));

  const reservation = resRows[0];
  if (!reservation) {
    throw Object.assign(new Error("Reservation not found"), { status: 404 });
  }

  const terms = reservation.terms as PaymentTerms;

  // Call X402Port.issueRequirement — UnsupportedStellarX402Adapter will throw
  // IntegrationConfigurationError, which the route layer catches and returns 503.
  const result = await x402Adapter.issueRequirement(terms);

  // Clamp expiresAt to min(requirement.expiresAt, now + 5 min).
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const clampedExpiresAt =
    result.requirement.expiresAt < fiveMinFromNow
      ? result.requirement.expiresAt
      : fiveMinFromNow;

  return {
    requirement: { ...result.requirement, expiresAt: clampedExpiresAt },
    sourceMode: result.sourceMode,
  };
}

// ---------------------------------------------------------------------------
// executePurchase
// ---------------------------------------------------------------------------

/**
 * Second leg of the x402 flow: execute a purchase using the buyer's signed payload.
 *
 * @param authorizationPayload - The signed x402 authorization payload from the Agent_Signer.
 * @param terms - PaymentTerms retrieved from the reservation (passed by the route layer).
 * @param reservationId - The reservation this purchase is for.
 * @param buyerId - Buyer identity from the session header.
 * @param idempotencyKey - Idempotency-Key header value.
 * @param requestHash - SHA-256 of the request body.
 * @param db - Database instance.
 */
export async function executePurchase(
  authorizationPayload: string,
  terms: PaymentTerms,
  reservationId: string,
  buyerId: string,
  idempotencyKey: string,
  requestHash: string,
  db: DB,
) {
  const { purchases, settlements, reservations, taskIntents, jobs, auditEvents } = getDb();

  // Idempotency check.
  const existing = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, buyerId),
        eq(purchases.idempotencyKey, idempotencyKey),
      ),
    );

  if (existing.length > 0) {
    const row = existing[0];
    if (row.requestHash !== requestHash) {
      throw new PurchaseServiceError(
        "Idempotency key reused with different request",
        409,
      );
    }
    if (row.status === "CONFIRMED") {
      return { status: 202, alreadyConfirmed: true };
    }
  }

  // Expiry check.
  if (terms.expiresAt < new Date().toISOString()) {
    throw new PurchaseServiceError(
      "Payment requirement has expired",
      402,
      "requirement_expired",
    );
  }

  // Generate purchase ID before the transaction so it can be passed to debit.
  const purchaseId = crypto.randomUUID();

  // Transaction 1: debit budget + create purchase row atomically.
  await db.transaction(async (tx) => {
    await debit(buyerId, terms.amountBaseUnits, purchaseId, tx as unknown as DB);

    await tx.insert(purchases).values({
      id: purchaseId,
      reservationId,
      buyerId,
      idempotencyKey,
      requestHash,
      amountBaseUnits: BigInt(terms.amountBaseUnits),
      network: terms.network,
      assetId: terms.assetId,
      assetDecimals: terms.assetDecimals,
      recipient: terms.recipient,
      sourceMode: "TESTNET",
      status: "CREATED",
      debitedBaseUnits: BigInt(terms.amountBaseUnits),
    });
  });

  // Update status to VERIFYING (best-effort, outside the transaction).
  await db
    .update(purchases)
    .set({ status: "VERIFYING" })
    .where(eq(purchases.id, purchaseId));

  // Call X402Port.verifyAndSettle.
  const result = await x402Adapter.verifyAndSettle({
    authorizationPayload,
    terms,
    purchaseId,
  });

  // Handle CONFIRMED.
  if (result.status === "CONFIRMED") {
    // Load reservation to find taskId.
    const resRows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    const reservation = resRows[0];

    // Insert settlement with ON CONFLICT DO NOTHING for duplicate events.
    await db
      .insert(settlements)
      .values({
        purchaseId,
        providerReference: result.providerReference ?? purchaseId,
        network: terms.network,
        recipient: terms.recipient,
        observedBaseUnits: BigInt(terms.amountBaseUnits),
        status: "CONFIRMED",
        confirmedAt: new Date(),
      })
      .onConflictDoNothing();

    // Update purchase status.
    const [updatedPurchase] = await db
      .update(purchases)
      .set({ status: "CONFIRMED" })
      .where(eq(purchases.id, purchaseId))
      .returning();

    // Activate task if reservation found and task is in PAYMENT_PENDING state.
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

    // Write audit events.
    await db.insert(auditEvents).values([
      {
        aggregateId: purchaseId,
        event: "PURCHASE_CONFIRMED",
        actor: buyerId,
        sourceMode: "TESTNET",
        metadata: { purchaseId, providerReference: result.providerReference ?? purchaseId },
      },
      {
        aggregateId: purchaseId,
        event: "SETTLEMENT_CREATED",
        actor: buyerId,
        sourceMode: "TESTNET",
        metadata: { purchaseId, providerReference: result.providerReference ?? purchaseId, observedAt: result.observedAt },
      },
    ]);

    return { status: 202, purchase: updatedPurchase };
  }

  // Handle UNKNOWN.
  if (result.status === "UNKNOWN") {
    await db
      .update(purchases)
      .set({ status: "UNKNOWN" })
      .where(eq(purchases.id, purchaseId));

    await db.insert(jobs).values({
      kind: "RECONCILE_PURCHASE",
      aggregateId: purchaseId,
      status: "READY",
      payload: {
        purchaseId,
        providerReference: result.providerReference ?? null,
      },
      runAfter: new Date(),
    });

    await db.insert(auditEvents).values({
      aggregateId: purchaseId,
      event: "PURCHASE_UNKNOWN",
      actor: buyerId,
      sourceMode: "TESTNET",
      metadata: { purchaseId, observedAt: result.observedAt },
    });

    return { status: 202, pending: true };
  }

  // Handle FAILED.
  await db
    .update(purchases)
    .set({ status: "FAILED" })
    .where(eq(purchases.id, purchaseId));

  // Restore budget — pass db directly (not inside a new transaction).
  await restore(buyerId, terms.amountBaseUnits, purchaseId, db);

  await db.insert(auditEvents).values({
    aggregateId: purchaseId,
    event: "PURCHASE_FAILED",
    actor: buyerId,
    sourceMode: "TESTNET",
    metadata: { purchaseId, observedAt: result.observedAt },
  });

  return { status: 402, reason: "payment_failed" };
}
