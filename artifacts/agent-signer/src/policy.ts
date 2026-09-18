export type SpendingPolicy = {
  network: string;
  assetCode: string;
  assetIssuer: string;
  assetDecimals: number;
  maxBaseUnits: string;        // integer string > 0
  recipientAllowlist: string[];
  expiresAt: string;           // ISO 8601 UTC
};

export type PaymentRequest = {
  taskContentHash: string;
  buyerPublicKey: string;
  recipientAddress: string;
  assetBaseUnits: string;      // integer string
  network: string;
  assetCode: string;
  assetIssuer: string;
  assetDecimals: number;
  expiresAt: string;           // ISO 8601 UTC
};

export type PolicyCheckResult =
  | { ok: true }
  | { ok: false; violatedField: string; reason: string };

/**
 * Enforces the spending policy against a payment request.
 * Returns on the first violation in the defined order.
 */
export function checkPolicy(policy: SpendingPolicy, request: PaymentRequest): PolicyCheckResult {
  // 1. Expiry
  if (new Date(policy.expiresAt) <= new Date()) {
    return { ok: false, violatedField: "expiresAt", reason: "policy has expired" };
  }

  // 2. Network
  if (request.network !== policy.network) {
    return {
      ok: false,
      violatedField: "network",
      reason: `request network "${request.network}" does not match policy network "${policy.network}"`,
    };
  }

  // 3. Asset code
  if (request.assetCode !== policy.assetCode) {
    return {
      ok: false,
      violatedField: "assetCode",
      reason: `request assetCode "${request.assetCode}" does not match policy assetCode "${policy.assetCode}"`,
    };
  }

  // 4. Asset issuer
  if (request.assetIssuer !== policy.assetIssuer) {
    return {
      ok: false,
      violatedField: "assetIssuer",
      reason: `request assetIssuer "${request.assetIssuer}" does not match policy assetIssuer "${policy.assetIssuer}"`,
    };
  }

  // 5. Asset decimals
  if (request.assetDecimals !== policy.assetDecimals) {
    return {
      ok: false,
      violatedField: "assetDecimals",
      reason: `request assetDecimals ${request.assetDecimals} does not match policy assetDecimals ${policy.assetDecimals}`,
    };
  }

  // 6. Amount
  if (BigInt(request.assetBaseUnits) > BigInt(policy.maxBaseUnits)) {
    return {
      ok: false,
      violatedField: "assetBaseUnits",
      reason: `request amount ${request.assetBaseUnits} exceeds policy maximum ${policy.maxBaseUnits}`,
    };
  }

  // 7. Recipient allowlist
  if (!policy.recipientAllowlist.includes(request.recipientAddress)) {
    return {
      ok: false,
      violatedField: "recipientAddress",
      reason: `recipient "${request.recipientAddress}" is not in the policy allowlist`,
    };
  }

  return { ok: true };
}
