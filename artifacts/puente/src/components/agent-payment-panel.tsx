import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpendingPolicy } from "./spending-policy-form";

// ---------------------------------------------------------------------------
// Types (inlined — do NOT import from @workspace/agent-signer, it uses
// Node.js crypto which is not available in the browser)
// ---------------------------------------------------------------------------

type PaymentRequest = {
  taskContentHash: string;
  buyerPublicKey: string;
  recipientAddress: string;
  assetBaseUnits: string;
  network: string;
  assetCode: string;
  assetIssuer: string;
  assetDecimals: number;
  expiresAt: string;
};

type PolicyCheckResult =
  | { ok: true }
  | { ok: false; violatedField: string; reason: string };

// ---------------------------------------------------------------------------
// Inlined checkPolicy logic (mirrors artifacts/agent-signer/src/policy.ts)
// ---------------------------------------------------------------------------

function checkPolicy(
  policy: SpendingPolicy,
  request: PaymentRequest,
): PolicyCheckResult {
  // 1. Expiry
  if (new Date(policy.expiresAt) <= new Date()) {
    return {
      ok: false,
      violatedField: "expiresAt",
      reason: "policy has expired",
    };
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

// ---------------------------------------------------------------------------
// Web Crypto helpers (Ed25519 — browser-native, no Node.js dependency)
// ---------------------------------------------------------------------------

/** base64url encode without padding */
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Canonical JSON: keys in lexicographic order, UTF-8 bytes as a plain ArrayBuffer */
function canonicalJson(obj: PaymentRequest): ArrayBuffer {
  const sorted = Object.fromEntries(
    (Object.keys(obj) as (keyof PaymentRequest)[]).sort().map((k) => [k, obj[k]]),
  );
  const encoded = new TextEncoder().encode(JSON.stringify(sorted));
  // Slice produces a plain ArrayBuffer (not SharedArrayBuffer) which satisfies BufferSource
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

/**
 * Export a CryptoKey (SPKI public key) as a base64url string.
 */
async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", key);
  return b64url(spki);
}

/**
 * Produce the authorizationPayload envelope matching the AgentSigner format:
 *   base64url( JSON.stringify({ publicKey: b64url(spki), request, signature: b64url(sig) }) )
 */
async function buildAuthorizationPayload(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  request: PaymentRequest,
): Promise<string> {
  const message = canonicalJson(request);
  const sigBuffer = await crypto.subtle.sign("Ed25519", privateKey, message);

  const signature = b64url(sigBuffer);
  const publicKeyB64 = await exportPublicKey(publicKey);

  const envelope = JSON.stringify({
    publicKey: publicKeyB64,
    request,
    signature,
  });

  return b64url(new TextEncoder().encode(envelope));
}

// ---------------------------------------------------------------------------
// Types for the server's 402 requirement shape
// Shape mirrors the PaymentRequest fields the server is expected to return.
// ---------------------------------------------------------------------------

type X402Requirement = {
  taskContentHash?: string;
  buyerPublicKey?: string;
  recipientAddress?: string;
  assetBaseUnits?: string;
  network?: string;
  assetCode?: string;
  assetIssuer?: string;
  assetDecimals?: number;
  expiresAt?: string;
  // The server may return additional informational fields
  [key: string]: unknown;
};

function requirementToPaymentRequest(req: X402Requirement): PaymentRequest {
  return {
    taskContentHash: String(req.taskContentHash ?? ""),
    buyerPublicKey: String(req.buyerPublicKey ?? ""),
    recipientAddress: String(req.recipientAddress ?? ""),
    assetBaseUnits: String(req.assetBaseUnits ?? "0"),
    network: String(req.network ?? ""),
    assetCode: String(req.assetCode ?? ""),
    assetIssuer: String(req.assetIssuer ?? ""),
    assetDecimals: Number(req.assetDecimals ?? 0),
    expiresAt: String(req.expiresAt ?? new Date(0).toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Component state types
// ---------------------------------------------------------------------------

type PanelState =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | {
      kind: "policy_violation";
      violatedField: string;
      reason: string;
    }
  | { kind: "success"; taskId: string; pending?: boolean }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AgentPaymentPanelProps {
  reservationId: string;
  policy: SpendingPolicy | null;
}

export default function AgentPaymentPanel({
  reservationId,
  policy,
}: AgentPaymentPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  // Ed25519 key pair — generated once per mount, discarded on page reload.
  // Private key is not extractable; it never leaves the browser's crypto context.
  const keyPairRef = useRef<CryptoKeyPair | null>(null);

  async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
    if (!keyPairRef.current) {
      keyPairRef.current = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        false, // not extractable — key bytes never leave the crypto context
        ["sign", "verify"],
      );
    }
    return keyPairRef.current;
  }

  async function initiatePurchase() {
    if (!policy) return;

    const idempotencyKey = crypto.randomUUID();

    setState({ kind: "busy", step: "Requesting payment requirement…" });

    // ------------------------------------------------------------------
    // Step 1: POST without X-Payment header — expect 402
    // ------------------------------------------------------------------
    let requirement: X402Requirement;
    try {
      const res = await fetch(
        `/api/puente/reservations/${encodeURIComponent(reservationId)}/purchase`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({}),
        },
      );

      if (res.status !== 402) {
        // Unexpected non-402 response
        const body = await res
          .json()
          .catch(() => ({ error: "Unexpected server response." })) as { error?: string };
        setState({
          kind: "error",
          message: body.error ?? `Unexpected status ${res.status} — expected 402.`,
        });
        return;
      }

      const body = await res.json() as { requirement?: X402Requirement; error?: string };
      if (!body.requirement) {
        setState({
          kind: "error",
          message: "Server returned 402 but no payment requirement object.",
        });
        return;
      }
      requirement = body.requirement;
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error while requesting payment requirement.",
      });
      return;
    }

    // ------------------------------------------------------------------
    // Step 2: Map requirement → PaymentRequest and run checkPolicy
    // ------------------------------------------------------------------
    setState({ kind: "busy", step: "Checking spending policy…" });
    const paymentRequest = requirementToPaymentRequest(requirement);
    const policyResult = checkPolicy(policy, paymentRequest);

    if (!policyResult.ok) {
      setState({
        kind: "policy_violation",
        violatedField: policyResult.violatedField,
        reason: policyResult.reason,
      });
      return;
    }

    // ------------------------------------------------------------------
    // Step 3: Sign the payment request with Web Crypto Ed25519
    // ------------------------------------------------------------------
    setState({ kind: "busy", step: "Signing payment request…" });

    let authorizationPayload: string;
    try {
      const keyPair = await getOrCreateKeyPair();
      authorizationPayload = await buildAuthorizationPayload(
        keyPair.privateKey,
        keyPair.publicKey,
        paymentRequest,
      );
    } catch (e) {
      // Ed25519 may not be supported in all browsers / runtimes
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "Ed25519 signing not available in this browser.";
      setState({ kind: "error", message: msg });
      return;
    }

    // ------------------------------------------------------------------
    // Step 4: Retry POST with X-Payment header (same Idempotency-Key)
    // ------------------------------------------------------------------
    setState({ kind: "busy", step: "Submitting payment…" });

    try {
      const res = await fetch(
        `/api/puente/reservations/${encodeURIComponent(reservationId)}/purchase`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-Payment": authorizationPayload,
          },
          body: JSON.stringify({}),
        },
      );

      if (res.status === 202) {
        const body = await res.json() as {
          taskId?: string;
          pending?: boolean;
          [key: string]: unknown;
        };
        setState({
          kind: "success",
          taskId: String(body.taskId ?? reservationId),
          pending: body.pending === true,
        });
        return;
      }

      if (res.status === 402) {
        const body = await res.json() as { error?: string };
        setState({
          kind: "error",
          message: body.error ?? "Payment rejected by server.",
        });
        return;
      }

      // Any other status
      const body = await res.json().catch(() => ({ error: "Unexpected server error." })) as { error?: string };
      setState({
        kind: "error",
        message: body.error ?? `Unexpected status ${res.status} from server.`,
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error while submitting payment.",
      });
    }
  }

  const isBusy = state.kind === "busy";

  return (
    <section className="app-panel" aria-label="Agent payment panel">
      <h3>Initiate Agent Payment</h3>
      <p>
        Your agent signs the x402 payment entirely on this device. Your private
        key never reaches the server.
      </p>

      {!policy && (
        <div className="app-no-policy" role="status">
          <Info size={15} />
          Set a spending policy above before initiating a payment.
        </div>
      )}

      <div className="app-actions">
        <Button
          disabled={!policy || isBusy}
          onClick={() => { void initiatePurchase(); }}
          title={!policy ? "Set a spending policy first" : undefined}
          aria-disabled={!policy || isBusy}
        >
          {isBusy ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Processing…
            </>
          ) : (
            "Initiate Purchase"
          )}
        </Button>
      </div>

      {isBusy && (
        <p className="app-step" aria-live="polite">
          {(state as { kind: "busy"; step: string }).step}
        </p>
      )}

      {state.kind === "policy_violation" && (
        <div className="app-policy-banner" role="alert">
          <AlertCircle size={15} />
          <div>
            <strong>Spending policy violation — not sent to server</strong>
            <br />
            Field: <code>{state.violatedField}</code>
            <br />
            {state.reason}
          </div>
        </div>
      )}

      {state.kind === "success" && (
        <div className="app-success" role="status">
          <CheckCircle2 size={20} />
          <div>
            <p>
              <strong>
                {state.pending
                  ? "Purchase submitted — pending confirmation"
                  : "Purchase submitted"}
              </strong>
            </p>
            <p>
              Task ID: <code>{state.taskId}</code>
            </p>
            {state.pending && (
              <p>
                The payment result is being reconciled. This page will reflect
                the final state once confirmed.
              </p>
            )}
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="app-error" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>Error</strong>
            {state.message}
          </div>
        </div>
      )}
    </section>
  );
}
