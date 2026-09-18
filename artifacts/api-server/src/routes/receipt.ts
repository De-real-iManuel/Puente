/**
 * receipt.ts
 *
 * GET /api/receipts/:taskId — returns a payment receipt for the given task.
 *
 * Authentication:
 *   x-buyer-id header        → role "buyer"
 *   x-worker-id header       → role "worker"
 *   Authorization: Bearer <secret> matching OPERATOR_SECRET → role "operator"
 *   None of the above        → 401
 *
 * Access control is enforced by ReceiptService.buildReceipt; any access
 * violation throws ReceiptAccessError which is mapped to 403 here.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import * as ReceiptService from "../puente/receipt-service";
import { ReceiptAccessError } from "../puente/receipt-service";
import type { PrincipalRole } from "../puente/receipt-service";

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
// Operator secret comparison — timing-safe, same pattern as operator-auth.ts
// ---------------------------------------------------------------------------

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isValidOperatorSecret(authHeader: string | undefined): boolean {
  const expectedSecret = process.env.OPERATOR_SECRET;
  if (!expectedSecret) return false;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return false;
  const incoming = authHeader.slice("Bearer ".length);
  try {
    return timingSafeEqual(sha256(incoming), sha256(expectedSecret));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET /api/receipts/:taskId
// ---------------------------------------------------------------------------

router.get("/receipts/:taskId", async (req: Request, res: Response) => {
  const taskId = String(req.params.taskId);

  // Determine principal.
  let principalRole: PrincipalRole;
  let principalId: string;

  const buyerId = req.headers["x-buyer-id"];
  const workerId = req.headers["x-worker-id"];
  const authHeader = req.headers["authorization"];

  if (typeof buyerId === "string" && buyerId) {
    principalRole = "buyer";
    principalId = buyerId;
  } else if (typeof workerId === "string" && workerId) {
    principalRole = "worker";
    principalId = workerId;
  } else if (isValidOperatorSecret(authHeader)) {
    principalRole = "operator";
    principalId = "operator";
  } else {
    problem(res, 401, "Authentication required.");
    return;
  }

  try {
    const { db } = getDbModule();
    const receipt = await ReceiptService.buildReceipt(taskId, principalRole, principalId, db);
    res.status(200).json(receipt);
  } catch (err) {
    if (err instanceof ReceiptAccessError) {
      problem(res, 403, "Access denied");
      return;
    }

    const e = err as { status?: number };
    if (e.status === 404) {
      problem(res, 404, "Task not found.");
      return;
    }

    problem(res, 500, "Could not retrieve receipt.");
  }
});

export default router;
