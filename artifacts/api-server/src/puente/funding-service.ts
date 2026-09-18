// Funding corridor service — manages the Funding_Order state machine.
// States: INSTRUCTIONS_ISSUED -> FIAT_CONFIRMED -> RELEASE_PENDING -> ASSET_CONFIRMED
// Terminal states: EXPIRED, FAILED

import { eq } from "drizzle-orm";
import type { db as _dbInstance } from "@workspace/db";
import { assertMoneyString } from "../lib/money";
import { ManualFundingAdapter } from "./integrations";
import { credit } from "./budget-service";

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

// Module-level adapter instance — never calls external services (MANUAL mode).
const fundingAdapter = new ManualFundingAdapter();

// ---------------------------------------------------------------------------
// createFundingOrder
// ---------------------------------------------------------------------------

export async function createFundingOrder(
  buyerId: string,
  ngnMinorUnits: string,
  expectedAssetBaseUnits: string,
  db: DB,
) {
  const { fundingOrders, auditEvents } = getDb();
  assertMoneyString(ngnMinorUnits, "ngnMinorUnits");
  assertMoneyString(expectedAssetBaseUnits, "expectedAssetBaseUnits");

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const instructions = await fundingAdapter.createInstructions({
    buyerId,
    ngnMinorUnits,
    expectedAssetBaseUnits,
    expiresAt,
  });

  const [row] = await db
    .insert(fundingOrders)
    .values({
      buyerId,
      ngnMinorUnits: BigInt(ngnMinorUnits),
      expectedAssetUnits: BigInt(expectedAssetBaseUnits),
      rate: "1",
      feeMinorUnits: 0n,
      mode: "MANUAL",
      status: "INSTRUCTIONS_ISSUED",
      providerReference: instructions.providerReference,
      expiresAt: new Date(expiresAt),
      sourceMode: instructions.sourceMode,
      bankAccountName: instructions.bankAccountName,
      accountNumber: instructions.accountNumber,
      bankName: instructions.bankName,
    })
    .returning();

  await db.insert(auditEvents).values({
    aggregateId: row.id,
    event: "FUNDING_ORDER_CREATED",
    actor: buyerId,
    sourceMode: "MANUAL",
    metadata: { ngnMinorUnits, expectedAssetBaseUnits },
  });

  return row;
}

// ---------------------------------------------------------------------------
// getFundingOrder
// ---------------------------------------------------------------------------

export async function getFundingOrder(id: string, db: DB) {
  const { fundingOrders, auditEvents } = getDb();

  const rows = await db
    .select()
    .from(fundingOrders)
    .where(eq(fundingOrders.id, id));

  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error("Funding order not found"), { status: 404 });
  }

  if (row.status === "INSTRUCTIONS_ISSUED" && row.expiresAt < new Date()) {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(fundingOrders)
        .set({ status: "EXPIRED" })
        .where(eq(fundingOrders.id, id))
        .returning();

      await tx.insert(auditEvents).values({
        aggregateId: id,
        event: "FUNDING_ORDER_EXPIRED",
        actor: row.buyerId,
        sourceMode: row.sourceMode,
        metadata: { expiredAt: new Date().toISOString() },
      });

      return updated;
    });
  }

  return row;
}

// ---------------------------------------------------------------------------
// confirmFundingOrder
// ---------------------------------------------------------------------------

export async function confirmFundingOrder(
  id: string,
  operatorId: string,
  ngnReceiptReference: string,
  db: DB,
) {
  const { fundingOrders, auditEvents } = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(fundingOrders)
      .where(eq(fundingOrders.id, id))
      .for("update");

    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error("Funding order not found"), { status: 404 });
    }
    if (row.status !== "INSTRUCTIONS_ISSUED") {
      throw Object.assign(
        new Error(`Cannot transition from ${row.status}`),
        { status: 409, currentState: row.status },
      );
    }

    const [updated] = await tx
      .update(fundingOrders)
      .set({ status: "FIAT_CONFIRMED", ngnReceiptReference })
      .where(eq(fundingOrders.id, id))
      .returning();

    await tx.insert(auditEvents).values({
      aggregateId: id,
      event: "FUNDING_ORDER_FIAT_CONFIRMED",
      actor: operatorId,
      sourceMode: row.sourceMode,
      metadata: { ngnReceiptReference, operatorId },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// releaseFundingOrder
// ---------------------------------------------------------------------------

export async function releaseFundingOrder(
  id: string,
  operatorId: string,
  releaseReference: string,
  db: DB,
) {
  const { fundingOrders, auditEvents } = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(fundingOrders)
      .where(eq(fundingOrders.id, id))
      .for("update");

    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error("Funding order not found"), { status: 404 });
    }
    if (row.status !== "FIAT_CONFIRMED") {
      throw Object.assign(
        new Error(`Cannot transition from ${row.status}`),
        { status: 409, currentState: row.status },
      );
    }

    const balanceCheck = await fundingAdapter.checkWalletBalance({
      fundingOrderId: id,
      walletAddress: "",
      expectedBaseUnits: row.expectedAssetUnits.toString(),
    });

    if (!balanceCheck.confirmed) {
      throw Object.assign(
        new Error("Wallet balance not confirmed"),
        { status: 409, reason: "wallet balance not confirmed" },
      );
    }

    const [updated] = await tx
      .update(fundingOrders)
      .set({ status: "RELEASE_PENDING", releaseReference })
      .where(eq(fundingOrders.id, id))
      .returning();

    await tx.insert(auditEvents).values({
      aggregateId: id,
      event: "FUNDING_ORDER_RELEASE_PENDING",
      actor: operatorId,
      sourceMode: row.sourceMode,
      metadata: { releaseReference, operatorId },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// assetConfirmedFundingOrder
// ---------------------------------------------------------------------------

export async function assetConfirmedFundingOrder(
  id: string,
  operatorId: string,
  stellarTxReference: string,
  confirmedBaseUnits: string,
  db: DB,
) {
  const { fundingOrders, auditEvents } = getDb();
  assertMoneyString(confirmedBaseUnits, "confirmedBaseUnits");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(fundingOrders)
      .where(eq(fundingOrders.id, id))
      .for("update");

    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error("Funding order not found"), { status: 404 });
    }
    if (row.status !== "RELEASE_PENDING") {
      throw Object.assign(
        new Error(`Cannot transition from ${row.status}`),
        { status: 409, currentState: row.status },
      );
    }

    const [updated] = await tx
      .update(fundingOrders)
      .set({ status: "ASSET_CONFIRMED", stellarTxReference, sourceMode: "TESTNET" })
      .where(eq(fundingOrders.id, id))
      .returning();

    await tx.insert(auditEvents).values({
      aggregateId: id,
      event: "FUNDING_ORDER_ASSET_CONFIRMED",
      actor: operatorId,
      sourceMode: "TESTNET",
      metadata: { stellarTxReference, confirmedBaseUnits, operatorId, sourceMode: "TESTNET" },
    });

    // Credit the buyer's agent budget inside this same transaction.
    await credit(row.buyerId, confirmedBaseUnits, id, tx as unknown as DB);

    return updated;
  });
}
