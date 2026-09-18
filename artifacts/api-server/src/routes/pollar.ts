/**
 * pollar.ts
 *
 * Routes for Pollar wallet configuration and sponsored transaction checks.
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 9.1
 */

import { Router, type Request, type Response } from "express";
import { assertPollarKey } from "../lib/source-mode-guard";
import { PollarTestnetAdapter, IntegrationConfigurationError } from "../puente/integrations";

const router = Router();

function problem(res: Response, code: number, message: string, extra?: object) {
  return res.status(code).json({ error: message, ...extra });
}

// ---------------------------------------------------------------------------
// GET /api/pollar/config — public: return validated publishable key or null
// ---------------------------------------------------------------------------
router.get("/pollar/config", (_req: Request, res: Response) => {
  const result = assertPollarKey(process.env.POLLAR_PUBLISHABLE_KEY);
  // result is the validated key string, or null if absent/malformed.
  // We never expose a raw key that failed validation; assertPollarKey handles this safely.
  res.json({ publishableKey: result });
});

// ---------------------------------------------------------------------------
// POST /api/pollar/sponsored-check — buyer or worker session
// ---------------------------------------------------------------------------
router.post("/pollar/sponsored-check", async (req: Request, res: Response) => {
  const buyerId = req.headers["x-buyer-id"];
  const workerId = req.headers["x-worker-id"];

  if (
    (typeof buyerId !== "string" || !buyerId) &&
    (typeof workerId !== "string" || !workerId)
  ) {
    problem(res, 401, "x-buyer-id or x-worker-id header is required.");
    return;
  }

  const { walletAddress } = req.body as { walletAddress?: unknown };

  if (typeof walletAddress !== "string" || !walletAddress) {
    problem(res, 400, "walletAddress must be a non-empty string.");
    return;
  }

  try {
    const adapter = new PollarTestnetAdapter();
    const result = await adapter.submitSponsoredCheck(walletAddress);
    // Only return txHash and sourceMode — never include private keys or secrets.
    res.json({ txHash: result.txHash, sourceMode: result.sourceMode });
  } catch (err) {
    if (err instanceof IntegrationConfigurationError) {
      // Expected: SDK gap is documented. Return 503 with the error reason.
      problem(res, 503, err.message);
      return;
    }
    problem(res, 500, "Could not complete sponsored check.");
  }
});

export default router;
