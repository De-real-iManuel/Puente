import { Router, type Request, type Response } from "express";
import { desc } from "drizzle-orm";
import { assertMoneyString, MoneyValidationError } from "../lib/money";
import { requireOperator } from "../lib/operator-auth";
import { IntegrationConfigurationError } from "../puente/integrations";
import * as FundingService from "../puente/funding-service";

// Lazy DB accessor — avoids crashing at module load when DATABASE_URL is absent.
// The DATABASE_URL check in @workspace/db fires at import time; deferring to
// the first request keeps the server process alive during tests that probe the
// /api/puente/config endpoint without a database.
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
// POST /api/funding-orders — buyer initiates a funding order
// ---------------------------------------------------------------------------
router.post("/funding-orders", async (req: Request, res: Response) => {
  const buyerId = req.headers["x-buyer-id"];
  if (typeof buyerId !== "string" || !buyerId) {
    problem(res, 401, "x-buyer-id header is required.");
    return;
  }

  try {
    assertMoneyString(req.body?.ngnMinorUnits, "ngnMinorUnits");
    assertMoneyString(req.body?.expectedAssetBaseUnits, "expectedAssetBaseUnits");
  } catch (err) {
    if (err instanceof MoneyValidationError) {
      problem(res, 400, err.message, { field: (err as MoneyValidationError).field });
      return;
    }
    throw err;
  }

  const { ngnMinorUnits, expectedAssetBaseUnits } = req.body as {
    ngnMinorUnits: string;
    expectedAssetBaseUnits: string;
  };

  try {
    const { db } = getDbModule();
    const order = await FundingService.createFundingOrder(
      buyerId,
      ngnMinorUnits,
      expectedAssetBaseUnits,
      db,
    );
    res.status(201).json(order);
  } catch (err) {
    if (err instanceof IntegrationConfigurationError) {
      problem(res, 502, "Integration error");
      return;
    }
    problem(res, 500, "Could not create funding order.");
  }
});

// ---------------------------------------------------------------------------
// GET /api/funding-orders/:id — buyer reads their funding order
// ---------------------------------------------------------------------------
router.get("/funding-orders/:id", async (req: Request, res: Response) => {
  const buyerId = req.headers["x-buyer-id"];
  if (typeof buyerId !== "string" || !buyerId) {
    problem(res, 401, "x-buyer-id header is required.");
    return;
  }

  try {
    const { db } = getDbModule();
    const order = await FundingService.getFundingOrder(String(req.params.id), db);
    res.json(order);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      problem(res, 404, "Funding order not found.");
    } else if (err instanceof IntegrationConfigurationError) {
      problem(res, 502, "Integration error");
    } else {
      problem(res, 500, "Could not retrieve funding order.");
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/operator/funding/:id/confirm — operator marks fiat received
// ---------------------------------------------------------------------------
router.post(
  "/operator/funding/:id/confirm",
  requireOperator,
  async (req: Request, res: Response) => {
    const { ngnReceiptReference } = req.body as {
      ngnReceiptReference?: string;
    };

    if (
      typeof ngnReceiptReference !== "string" ||
      ngnReceiptReference.length < 1 ||
      ngnReceiptReference.length > 100
    ) {
      problem(res, 400, "ngnReceiptReference must be a string of 1–100 characters.");
      return;
    }

    // Operator identity derived from the auth header — never from request body.
    const authHeader = req.headers["authorization"] as string;
    const operatorId = authHeader.startsWith("Bearer ")
      ? `operator:${authHeader.slice(7, 20)}…`
      : "operator";

    try {
      const { db } = getDbModule();
      const order = await FundingService.confirmFundingOrder(
        String(req.params.id),
        operatorId,
        ngnReceiptReference,
        db,
      );
      res.json(order);
    } catch (err) {
      const e = err as { status?: number; currentState?: string };
      if (e.status === 404) {
        problem(res, 404, "Funding order not found.");
      } else if (e.status === 409) {
        problem(res, 409, "Cannot confirm from current state.", { currentState: e.currentState });
      } else if (err instanceof IntegrationConfigurationError) {
        problem(res, 502, "Integration error");
      } else {
        problem(res, 500, "Could not confirm funding order.");
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/operator/funding/:id/release — operator releases assets
// ---------------------------------------------------------------------------
router.post(
  "/operator/funding/:id/release",
  requireOperator,
  async (req: Request, res: Response) => {
    const { releaseReference } = req.body as { releaseReference?: string };

    if (typeof releaseReference !== "string" || releaseReference.length === 0) {
      problem(res, 400, "releaseReference must be a non-empty string.");
      return;
    }

    try {
      const { db } = getDbModule();
      const order = await FundingService.releaseFundingOrder(
        String(req.params.id),
        "operator",
        releaseReference,
        db,
      );
      res.json(order);
    } catch (err) {
      const e = err as { status?: number; currentState?: string };
      if (e.status === 404) {
        problem(res, 404, "Funding order not found.");
      } else if (e.status === 409) {
        problem(res, 409, "Cannot release from current state.", { currentState: e.currentState });
      } else if (err instanceof IntegrationConfigurationError) {
        problem(res, 502, "Integration error");
      } else {
        problem(res, 500, "Could not release funding order.");
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/operator/funding/:id/asset-confirmed — operator confirms on-chain
// ---------------------------------------------------------------------------
router.post(
  "/operator/funding/:id/asset-confirmed",
  requireOperator,
  async (req: Request, res: Response) => {
    const { stellarTxReference, confirmedBaseUnits } = req.body as {
      stellarTxReference?: string;
      confirmedBaseUnits?: string;
    };

    if (typeof stellarTxReference !== "string" || stellarTxReference.length === 0) {
      problem(res, 400, "stellarTxReference must be a non-empty string.");
      return;
    }

    try {
      assertMoneyString(confirmedBaseUnits, "confirmedBaseUnits");
    } catch (err) {
      if (err instanceof MoneyValidationError) {
        problem(res, 400, err.message, { field: (err as MoneyValidationError).field });
        return;
      }
      throw err;
    }

    try {
      const { db } = getDbModule();
      const order = await FundingService.assetConfirmedFundingOrder(
        String(req.params.id),
        "operator",
        stellarTxReference,
        confirmedBaseUnits as string,
        db,
      );
      res.json(order);
    } catch (err) {
      const e = err as { status?: number; currentState?: string };
      if (e.status === 404) {
        problem(res, 404, "Funding order not found.");
      } else if (e.status === 409) {
        problem(res, 409, "Cannot confirm asset from current state.", { currentState: e.currentState });
      } else if (err instanceof IntegrationConfigurationError) {
        problem(res, 502, "Integration error");
      } else {
        problem(res, 500, "Could not confirm asset receipt.");
      }
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/operator/funding-orders — operator lists all funding orders
// ---------------------------------------------------------------------------
router.get(
  "/operator/funding-orders",
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      const { db, fundingOrders } = getDbModule();
      const orders = await db
        .select()
        .from(fundingOrders)
        .orderBy(desc(fundingOrders.createdAt));
      res.json(orders);
    } catch {
      problem(res, 500, "Could not retrieve funding orders.");
    }
  },
);

export default router;
