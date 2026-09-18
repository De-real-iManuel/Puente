// Budget service — manages the agent_budgets table.
// All reads and writes use SELECT FOR UPDATE within a transaction to prevent
// concurrent double-spend. The balance can never go below 0.
//
// The `db` parameter accepts both the real db instance and a Drizzle transaction
// object — they share the same interface for query operations.

import { eq, sql } from "drizzle-orm";
import type { db as _dbInstance } from "@workspace/db";

type DbOrTx = typeof _dbInstance;

// Lazy accessor for schema — defers DATABASE_URL check to first request.
let _dbMod: typeof import("@workspace/db") | undefined;
function getDb(): typeof import("@workspace/db") {
  if (!_dbMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _dbMod = require("@workspace/db") as typeof import("@workspace/db");
  }
  return _dbMod;
}

// ---------------------------------------------------------------------------
// InsufficientBudgetError
// ---------------------------------------------------------------------------

export class InsufficientBudgetError extends Error {
  constructor(available: bigint, requested: bigint) {
    super(`Insufficient budget: available ${available}, requested ${requested}`);
    this.name = "InsufficientBudgetError";
  }
}

// ---------------------------------------------------------------------------
// credit
// ---------------------------------------------------------------------------

/**
 * Credit the buyer's agent budget by `baseUnits`.
 *
 * Must be called inside an existing transaction (pass `tx` as the `db` arg).
 * Locks the row with SELECT FOR UPDATE before deciding insert-vs-update so
 * that concurrent credits serialize correctly.
 */
export async function credit(
  buyerId: string,
  baseUnits: string,
  fundingOrderId: string,
  db: DbOrTx,
): Promise<void> {
  const { agentBudgets, auditEvents } = getDb();
  const amount = BigInt(baseUnits);

  // Lock the row (or obtain a row-level advisory gap lock for an insert).
  const rows = await db
    .select()
    .from(agentBudgets)
    .where(eq(agentBudgets.buyerId, buyerId))
    .for("update");

  if (rows.length === 0) {
    // No row yet — insert with the initial balance.
    await db.insert(agentBudgets).values({
      buyerId,
      balanceBaseUnits: amount,
      updatedAt: new Date(),
    });
  } else {
    const current = rows[0].balanceBaseUnits;
    await db
      .update(agentBudgets)
      .set({
        balanceBaseUnits: current + amount,
        updatedAt: new Date(),
      })
      .where(eq(agentBudgets.buyerId, buyerId));
  }

  // Audit trail.
  await db.insert(auditEvents).values({
    aggregateId: buyerId,
    event: "BUDGET_CREDITED",
    actor: buyerId,
    sourceMode: "MANUAL",
    metadata: {
      fundingOrderId,
      direction: "credit",
      baseUnits,
      timestamp: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// debit
// ---------------------------------------------------------------------------

/**
 * Debit the buyer's agent budget by `baseUnits`.
 *
 * Throws `InsufficientBudgetError` when the current balance is less than the
 * requested amount. Must be called inside a transaction.
 */
export async function debit(
  buyerId: string,
  baseUnits: string,
  purchaseId: string,
  db: DbOrTx,
): Promise<void> {
  const { agentBudgets, auditEvents } = getDb();
  const amount = BigInt(baseUnits);

  const rows = await db
    .select()
    .from(agentBudgets)
    .where(eq(agentBudgets.buyerId, buyerId))
    .for("update");

  const current = rows.length > 0 ? rows[0].balanceBaseUnits : 0n;

  if (current < amount) {
    throw new InsufficientBudgetError(current, amount);
  }

  await db
    .update(agentBudgets)
    .set({
      balanceBaseUnits: sql`${agentBudgets.balanceBaseUnits} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(agentBudgets.buyerId, buyerId));

  await db.insert(auditEvents).values({
    aggregateId: buyerId,
    event: "BUDGET_DEBITED",
    actor: buyerId,
    sourceMode: "MANUAL",
    metadata: {
      purchaseId,
      direction: "debit",
      baseUnits,
      timestamp: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

/**
 * Restore a previously debited amount back to the buyer's agent budget.
 * Used when a purchase fails after the budget was already debited.
 */
export async function restore(
  buyerId: string,
  baseUnits: string,
  purchaseId: string,
  db: DbOrTx,
): Promise<void> {
  const { agentBudgets, auditEvents } = getDb();
  const amount = BigInt(baseUnits);

  const rows = await db
    .select()
    .from(agentBudgets)
    .where(eq(agentBudgets.buyerId, buyerId))
    .for("update");

  if (rows.length === 0) {
    // Budget row was never created (edge case: debit succeeded via no-row path).
    // Insert with the restored amount as the initial balance.
    await db.insert(agentBudgets).values({
      buyerId,
      balanceBaseUnits: amount,
      updatedAt: new Date(),
    });
  } else {
    const current = rows[0].balanceBaseUnits;
    await db
      .update(agentBudgets)
      .set({
        balanceBaseUnits: current + amount,
        updatedAt: new Date(),
      })
      .where(eq(agentBudgets.buyerId, buyerId));
  }

  await db.insert(auditEvents).values({
    aggregateId: buyerId,
    event: "BUDGET_CREDIT_RESTORED",
    actor: buyerId,
    sourceMode: "MANUAL",
    metadata: {
      purchaseId,
      direction: "credit",
      baseUnits,
      timestamp: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

/**
 * Return the buyer's current agent budget balance.
 * Returns `0n` when no row exists for the buyer.
 */
export async function getBalance(
  buyerId: string,
  db: DbOrTx,
): Promise<bigint> {
  const { agentBudgets } = getDb();

  const rows = await db
    .select({ balanceBaseUnits: agentBudgets.balanceBaseUnits })
    .from(agentBudgets)
    .where(eq(agentBudgets.buyerId, buyerId));

  return rows.length > 0 ? rows[0].balanceBaseUnits : 0n;
}
