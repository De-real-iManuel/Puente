// receipt-service.ts
//
// Assembles a payment receipt for a given taskId.
// Enforces access control: buyer, worker, and operator roles.
// Redacts wallet/recipient addresses (last 8 chars only) before returning.

import { eq } from "drizzle-orm";
import type { db as _dbInstance } from "@workspace/db";

// Derive DB type from the type-only import.
type DB = typeof _dbInstance;

// Lazy accessor for schema/db.
let _dbMod: typeof import("@workspace/db") | undefined;
function getDb(): typeof import("@workspace/db") {
  if (!_dbMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _dbMod = require("@workspace/db") as typeof import("@workspace/db");
  }
  return _dbMod;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PrincipalRole = "buyer" | "worker" | "operator";

export class ReceiptAccessError extends Error {
  constructor() {
    super("Access denied");
    this.name = "ReceiptAccessError";
  }
}

export type FundingLeg = {
  fundingOrderId: string;
  ngnMinorUnits: string;
  expectedAssetUnits: string;
  status: string;
  sourceMode: string;
  bankAccountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  providerReference: string | null;
  expiresAt: string;
  ngnReceiptReference: string | null;
  releaseReference: string | null;
  stellarTxReference: string | null;
  createdAt: string;
};

export type PaymentLeg = {
  purchaseId: string;
  amountBaseUnits: string;
  network: string;
  assetId: string;
  assetDecimals: number;
  /** Redacted to last 8 characters. */
  recipient: string;
  status: string;
  sourceMode: string;
  settlement: {
    providerReference: string;
    observedBaseUnits: string;
    confirmedAt: string | null;
  } | null;
  createdAt: string;
};

export type PayoutLeg = {
  payoutOrderId: string;
  assetBaseUnits: string;
  bobMinorUnits: string;
  feeBaseUnits: string;
  exchangeRate: string;
  /** Redacted to last 8 characters. */
  workerWallet: string;
  sourceMode: string;
  status: string;
  createdAt: string;
};

export type Receipt = {
  taskId: string;
  fundingLeg: FundingLeg | null;
  paymentLeg: PaymentLeg | null;
  payoutLeg: PayoutLeg | null;
  mockNotice?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_SOURCE_MODES = new Set<string>(["TESTNET", "MANUAL", "FIXTURE"]);

function redactAddress(address: string): string {
  return address.slice(-8);
}

function isMockMode(mode: string | null | undefined): boolean {
  return typeof mode === "string" && MOCK_SOURCE_MODES.has(mode);
}

// ---------------------------------------------------------------------------
// buildReceipt
// ---------------------------------------------------------------------------

export async function buildReceipt(
  taskId: string,
  principalRole: PrincipalRole,
  principalId: string,
  db: DB,
): Promise<Receipt> {
  const { taskIntents, reservations, purchases, settlements, fundingOrders, payoutOrders } =
    getDb();

  // Load task — 404 if missing.
  const taskRows = await db
    .select()
    .from(taskIntents)
    .where(eq(taskIntents.id, taskId));

  const task = taskRows[0];
  if (!task) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------
  if (principalRole === "buyer") {
    if (task.buyerId !== principalId) {
      throw new ReceiptAccessError();
    }
  } else if (principalRole === "worker") {
    // Find reservation for this task and verify workerId matches.
    const resRows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.taskId, taskId));

    const reservation = resRows[0];
    if (!reservation || reservation.workerId !== principalId) {
      throw new ReceiptAccessError();
    }
  } else if (principalRole !== "operator") {
    // Unknown role.
    throw new ReceiptAccessError();
  }

  // ---------------------------------------------------------------------------
  // Load reservation (needed to find purchase by reservationId).
  // ---------------------------------------------------------------------------
  const reservationRows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.taskId, taskId));

  const reservation = reservationRows[0];

  // ---------------------------------------------------------------------------
  // Payment leg — purchase + settlement
  // ---------------------------------------------------------------------------
  let paymentLeg: PaymentLeg | null = null;
  let fundingLeg: FundingLeg | null = null;

  if (reservation) {
    const purchaseRows = await db
      .select()
      .from(purchases)
      .where(eq(purchases.reservationId, reservation.id));

    const purchase = purchaseRows[0];

    if (purchase) {
      // Load settlement.
      const settlementRows = await db
        .select()
        .from(settlements)
        .where(eq(settlements.purchaseId, purchase.id));

      const settlement = settlementRows[0] ?? null;

      paymentLeg = {
        purchaseId: purchase.id,
        amountBaseUnits: purchase.amountBaseUnits.toString(),
        network: purchase.network,
        assetId: purchase.assetId,
        assetDecimals: purchase.assetDecimals,
        recipient: redactAddress(purchase.recipient),
        status: purchase.status,
        sourceMode: purchase.sourceMode,
        settlement: settlement
          ? {
              providerReference: settlement.providerReference,
              observedBaseUnits: settlement.observedBaseUnits.toString(),
              confirmedAt: settlement.confirmedAt ? settlement.confirmedAt.toISOString() : null,
            }
          : null,
        createdAt: purchase.createdAt.toISOString(),
      };

      // Funding leg — present only if purchase links to a funding order.
      if (purchase.fundingOrderId) {
        const foRows = await db
          .select()
          .from(fundingOrders)
          .where(eq(fundingOrders.id, purchase.fundingOrderId));

        const fo = foRows[0];
        if (fo) {
          fundingLeg = {
            fundingOrderId: fo.id,
            ngnMinorUnits: fo.ngnMinorUnits.toString(),
            expectedAssetUnits: fo.expectedAssetUnits.toString(),
            status: fo.status,
            sourceMode: fo.sourceMode,
            bankAccountName: fo.bankAccountName ?? null,
            accountNumber: fo.accountNumber ?? null,
            bankName: fo.bankName ?? null,
            providerReference: fo.providerReference ?? null,
            expiresAt: fo.expiresAt.toISOString(),
            ngnReceiptReference: fo.ngnReceiptReference ?? null,
            releaseReference: fo.releaseReference ?? null,
            stellarTxReference: fo.stellarTxReference ?? null,
            createdAt: fo.createdAt.toISOString(),
          };
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Payout leg — via payoutOrders.taskId
  // ---------------------------------------------------------------------------
  let payoutLeg: PayoutLeg | null = null;

  const payoutRows = await db
    .select()
    .from(payoutOrders)
    .where(eq(payoutOrders.taskId, taskId));

  const payout = payoutRows[0];
  if (payout) {
    payoutLeg = {
      payoutOrderId: payout.id,
      assetBaseUnits: payout.assetBaseUnits.toString(),
      bobMinorUnits: payout.bobMinorUnits.toString(),
      feeBaseUnits: payout.feeBaseUnits.toString(),
      exchangeRate: payout.exchangeRate,
      workerWallet: redactAddress(payout.workerWallet),
      sourceMode: payout.sourceMode,
      status: payout.status,
      createdAt: payout.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // mockNotice — present when any leg uses a simulated sourceMode
  // ---------------------------------------------------------------------------
  const allSourceModes: (string | null | undefined)[] = [
    fundingLeg?.sourceMode,
    paymentLeg?.sourceMode,
    payoutLeg?.sourceMode,
  ];

  const hasMock = allSourceModes.some(isMockMode);

  return {
    taskId,
    fundingLeg,
    paymentLeg,
    payoutLeg,
    ...(hasMock
      ? { mockNotice: "This transaction was simulated and does not represent real funds." }
      : {}),
  };
}
