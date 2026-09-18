// SourceMode identifies where a payment or adapter response originated.
// "FIXTURE" is used for hackathon mocks that never call external services.
export type SourceMode = "LIVE" | "TESTNET" | "SANDBOX" | "MANUAL" | "FIXTURE";

export class IntegrationConfigurationError extends Error {
  constructor(public integration: string, detail: string) {
    super(`${integration} is not configured: ${detail}`);
  }
}

// Base shape every adapter response must carry.
export type AdapterResponse = {
  sourceMode: SourceMode;
  providerReference?: string;
  observedAt: string; // ISO 8601 UTC
};

export type PaymentTerms = {
  amountBaseUnits: string;
  network: string;
  assetId: string;
  assetDecimals: number;
  recipient: string;
  expiresAt: string;
};

export type X402Requirement = {
  network: string;
  assetId: string;
  assetDecimals: number;
  recipient: string;
  amountBaseUnits: string;
  expiresAt: string;
  idempotencyKeyEcho?: string;
};

// ---------------------------------------------------------------------------
// X402Port — x402 HTTP payment protocol
// ---------------------------------------------------------------------------

export interface X402Port {
  readonly sourceMode: SourceMode;
  /** Primary method — issue a fresh 402 requirement to a buyer. */
  issueRequirement(terms: PaymentTerms): Promise<{
    requirement: X402Requirement;
    sourceMode: SourceMode;
    observedAt: string;
  }>;
  /** Backward-compat alias kept so existing callers do not break. */
  requirements(terms: PaymentTerms): Promise<unknown>;
  verifyAndSettle(input: {
    authorizationPayload: string;
    terms: PaymentTerms;
    purchaseId: string;
  }): Promise<{
    status: "CONFIRMED" | "FAILED" | "UNKNOWN";
    providerReference?: string;
    observedAt: string;
    sourceMode: SourceMode;
  }>;
  lookup(providerReference: string): Promise<{
    status: "CONFIRMED" | "FAILED" | "UNKNOWN";
    observedAt: string;
    sourceMode: SourceMode;
  }>;
}

export class UnsupportedStellarX402Adapter implements X402Port {
  readonly sourceMode = "LIVE" as const;

  private blocked(): never {
    throw new IntegrationConfigurationError(
      "Stellar x402",
      "a primary-source facilitator URL, supported network/asset, mechanism package and signing flow are required",
    );
  }

  async issueRequirement(_terms: PaymentTerms): Promise<never> {
    return this.blocked();
  }

  /** Backward-compat wrapper — delegates to issueRequirement. */
  async requirements(_terms: PaymentTerms): Promise<unknown> {
    return this.issueRequirement(_terms);
  }

  async verifyAndSettle(_input: {
    authorizationPayload: string;
    terms: PaymentTerms;
    purchaseId: string;
  }): Promise<never> {
    return this.blocked();
  }

  async lookup(_providerReference: string): Promise<never> {
    return this.blocked();
  }
}

// ---------------------------------------------------------------------------
// FundingPort — Nigerian funding corridor
// ---------------------------------------------------------------------------

export interface FundingPort {
  readonly sourceMode: SourceMode;
  createInstructions(input: {
    buyerId: string;
    ngnMinorUnits: string;          // kobo, integer string
    expectedAssetBaseUnits: string; // USDC microUSDC, integer string
    expiresAt: string;              // ISO 8601 UTC
  }): Promise<{
    providerReference: string;
    bankAccountName: string;
    accountNumber: string;
    bankName: string;
    sourceMode: SourceMode;
    observedAt: string;
  }>;
  confirmReceipt(input: {
    fundingOrderId: string;
    operatorId: string;
    ngnReceiptReference: string; // 1–100 chars
  }): Promise<{ sourceMode: SourceMode; observedAt: string }>;
  checkWalletBalance(input: {
    fundingOrderId: string;
    walletAddress: string;
    expectedBaseUnits: string;
  }): Promise<{ confirmed: boolean; sourceMode: SourceMode; observedAt: string }>;
}

// Task 2.2 — ManualFundingAdapter: semi-manual operator flow for hackathon demo.
// Uses hardcoded placeholder bank details; never calls any external service.
export class ManualFundingAdapter implements FundingPort {
  readonly sourceMode = "MANUAL" as const;

  async createInstructions(input: {
    buyerId: string;
    ngnMinorUnits: string;
    expectedAssetBaseUnits: string;
    expiresAt: string;
  }): Promise<{
    providerReference: string;
    bankAccountName: string;
    accountNumber: string;
    bankName: string;
    sourceMode: SourceMode;
    observedAt: string;
  }> {
    // Suppress unused-variable warnings — parameters are recorded upstream.
    void input;
    return {
      providerReference: crypto.randomUUID(),
      bankAccountName: "Puente Demo Operator",
      accountNumber: "0123456789",
      bankName: "First Bank Nigeria",
      sourceMode: "MANUAL",
      observedAt: new Date().toISOString(),
    };
  }

  async confirmReceipt(input: {
    fundingOrderId: string;
    operatorId: string;
    ngnReceiptReference: string;
  }): Promise<{ sourceMode: SourceMode; observedAt: string }> {
    const { ngnReceiptReference } = input;
    if (
      typeof ngnReceiptReference !== "string" ||
      ngnReceiptReference.length < 1 ||
      ngnReceiptReference.length > 100
    ) {
      throw new IntegrationConfigurationError(
        "ManualFundingAdapter.confirmReceipt",
        "ngnReceiptReference must be a string of 1–100 characters",
      );
    }
    return { sourceMode: "MANUAL", observedAt: new Date().toISOString() };
  }

  async checkWalletBalance(input: {
    fundingOrderId: string;
    walletAddress: string;
    expectedBaseUnits: string;
  }): Promise<{ confirmed: boolean; sourceMode: SourceMode; observedAt: string }> {
    // Manual attestation model: the operator's confirmation is the evidence.
    void input;
    return { confirmed: true, sourceMode: "MANUAL", observedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// WalletPort — server-side Pollar wallet operations
// ---------------------------------------------------------------------------

export interface WalletPort {
  readonly sourceMode: SourceMode;
  getBalance(walletAddress: string): Promise<{
    assetBaseUnits: string;
    sourceMode: SourceMode;
    observedAt: string;
  }>;
  submitSponsoredCheck(walletAddress: string): Promise<{
    txHash: string;
    sourceMode: SourceMode;
    observedAt: string;
  }>;
}

// Task 2.4 — PollarTestnetAdapter.
// @pollar/core v0.10.1 is a browser/client SDK built around DPoP auth flows.
// It does NOT expose server-side stateless wallet helpers; the two methods
// below document the capability gap so callers fail clearly rather than
// silently misusing an authenticated client session.
export class PollarTestnetAdapter implements WalletPort {
  readonly sourceMode = "TESTNET" as const;

  async getBalance(_walletAddress: string): Promise<{
    assetBaseUnits: string;
    sourceMode: SourceMode;
    observedAt: string;
  }> {
    throw new IntegrationConfigurationError(
      "Pollar testnet wallet",
      "getWalletBalance requires an authenticated PollarClient session — @pollar/core does not expose a server-side balance check; use Horizon directly via GET /accounts/{address} or implement via StellarClient",
    );
  }

  async submitSponsoredCheck(_walletAddress: string): Promise<{
    txHash: string;
    sourceMode: SourceMode;
    observedAt: string;
  }> {
    throw new IntegrationConfigurationError(
      "Pollar testnet sponsored check",
      "submitSponsoredCheck is not exposed by @pollar/core — the SDK provides sponsored account creation via POST /wallet/account/create/build for external wallets; a server-side sponsored check requires a Pollar API key and direct REST call",
    );
  }
}

// ---------------------------------------------------------------------------
// RampPort — BOB cash-out
// ---------------------------------------------------------------------------

export interface RampPort {
  readonly sourceMode: SourceMode;
  quote(input: {
    workerWalletAddress: string;
    assetBaseUnits: string;
  }): Promise<{
    quoteId: string;
    bobMinorUnits: string;
    feeBaseUnits: string;
    exchangeRate: string;
    expiresAt: string;
    sourceMode: SourceMode;
    observedAt: string;
  }>;
  submitPayout(input: {
    quoteId: string;
    workerWalletAddress: string;
    idempotencyKey: string;
  }): Promise<{
    payoutReference: string;
    status: "SIMULATED";
    sourceMode: "FIXTURE";
    observedAt: string;
  }>;
}

// Task 2.3 — FixtureRampAdapter: always FIXTURE / SIMULATED, never calls Pollar ramp API.
export class FixtureRampAdapter implements RampPort {
  readonly sourceMode = "FIXTURE" as const;

  async quote(input: {
    workerWalletAddress: string;
    assetBaseUnits: string;
  }): Promise<{
    quoteId: string;
    bobMinorUnits: string;
    feeBaseUnits: string;
    exchangeRate: string;
    expiresAt: string;
    sourceMode: SourceMode;
    observedAt: string;
  }> {
    void input;
    return {
      quoteId: crypto.randomUUID(),
      bobMinorUnits: "95000",  // deterministic mock — approx 95 BOB
      feeBaseUnits: "5000",    // deterministic mock fee in USDC microunits
      exchangeRate: "1",
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
      sourceMode: "FIXTURE",
      observedAt: new Date().toISOString(),
    };
  }

  async submitPayout(input: {
    quoteId: string;
    workerWalletAddress: string;
    idempotencyKey: string;
  }): Promise<{
    payoutReference: string;
    status: "SIMULATED";
    sourceMode: "FIXTURE";
    observedAt: string;
  }> {
    void input;
    return {
      payoutReference: crypto.randomUUID(),
      status: "SIMULATED",
      sourceMode: "FIXTURE",
      observedAt: new Date().toISOString(),
    };
  }
}

// Kept for any code that still references the old name.
export class UnconfiguredPollarRampAdapter implements RampPort {
  readonly sourceMode = "LIVE" as const;

  async quote(): Promise<never> {
    throw new IntegrationConfigurationError(
      "Pollar BOB cash-out",
      "the official quote, consent, submit and status contract is required",
    );
  }

  async submitPayout(): Promise<never> {
    throw new IntegrationConfigurationError(
      "Pollar BOB cash-out",
      "the official quote, consent, submit and status contract is required",
    );
  }
}

// ---------------------------------------------------------------------------
// Startup guard
// ---------------------------------------------------------------------------

export function assertLivePaymentConfiguration(env: NodeJS.ProcessEnv) {
  if (env.PAYMENT_MODE !== "live") return;
  const required = [
    "X402_FACILITATOR_URL",
    "X402_NETWORK",
    "X402_ASSET_ID",
    "X402_ASSET_DECIMALS",
    "POLLAR_PUBLISHABLE_KEY",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new IntegrationConfigurationError("Live x402", `missing ${missing.join(", ")}`);
  throw new IntegrationConfigurationError(
    "Live Stellar x402",
    "configuration values alone are insufficient; install only an organizer-supported Stellar mechanism and signing implementation",
  );
}
