import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Monetary helpers (BigInt only — never Number for money)
// ---------------------------------------------------------------------------

/** Formats USDC base units (6 decimals) as a human-readable string. */
function formatUsdc(baseUnits: string): string {
  const units = BigInt(baseUnits);
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, "0")} USDC`;
}

/** Formats BOB minor units (2 decimals) as a human-readable string. */
function formatBob(minorUnits: string): string {
  const units = BigInt(minorUnits);
  const whole = units / 100n;
  const frac = units % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")} BOB`;
}

// ---------------------------------------------------------------------------
// Expiry countdown (mirrors nigerian-funding-card.tsx pattern)
// ---------------------------------------------------------------------------

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(
        Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remaining <= 0) {
    return (
      <span className="bpc-expiry bpc-expiry--expired">
        <Clock size={13} /> Expired
      </span>
    );
  }

  const secs = remaining % 60;
  const label = `${secs}s`;

  return (
    <span className={`bpc-expiry${remaining < 15 ? " bpc-expiry--urgent" : ""}`}>
      <Clock size={13} /> Quote expires in {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quote shape returned by POST /api/puente/payout-quotes
// ---------------------------------------------------------------------------

type PayoutQuote = {
  quoteId: string;
  bobMinorUnits: string;
  feeBaseUnits: string;
  exchangeRate: string;
  expiresAt: string;
  sourceMode: string;
  observedAt: string;
};

// ---------------------------------------------------------------------------
// Component state
// ---------------------------------------------------------------------------

type CardState =
  | { kind: "idle"; reason: string }
  | { kind: "fetching_quote" }
  | { kind: "quote_ready"; quote: PayoutQuote }
  | { kind: "quote_expired" }
  | { kind: "authorising" }
  | {
      kind: "success";
      payoutReference: string;
      sourceMode: string;
      observedAt: string;
    }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BobPayoutCardProps {
  taskId: string;
  taskStatus: string; // "CONFIRMED" is the trigger state
  workerWalletAddress: string | null; // null means wallet not connected
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BobPayoutCard({
  taskId,
  taskStatus,
  workerWalletAddress,
}: BobPayoutCardProps) {
  const initialState = (): CardState => {
    if (taskStatus !== "CONFIRMED") {
      return { kind: "idle", reason: "Payout is available once the task payment is confirmed." };
    }
    if (!workerWalletAddress) {
      return { kind: "idle", reason: "Connect your worker wallet to request a payout." };
    }
    return { kind: "fetching_quote" };
  };

  const [state, setState] = useState<CardState>(initialState);
  const didFetchRef = useRef(false);

  // Auto-fetch quote when component mounts in a ready state.
  useEffect(() => {
    if (
      state.kind === "fetching_quote" &&
      !didFetchRef.current &&
      workerWalletAddress
    ) {
      didFetchRef.current = true;
      void fetchQuote(workerWalletAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  async function fetchQuote(walletAddress: string) {
    setState({ kind: "fetching_quote" });
    try {
      const res = await fetch("/api/puente/payout-quotes", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": walletAddress,
        },
        body: JSON.stringify({ taskId, workerWalletAddress: walletAddress }),
      });

      const body = await res.json() as PayoutQuote & { error?: string };

      if (!res.ok) {
        setState({
          kind: "error",
          message: body.error ?? `Unexpected status ${res.status} from server.`,
        });
        return;
      }

      setState({ kind: "quote_ready", quote: body });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error fetching payout quote.",
      });
    }
  }

  async function authorisePayout(quote: PayoutQuote) {
    if (!workerWalletAddress) return;

    // Check client-side expiry before calling the server.
    if (new Date(quote.expiresAt) <= new Date()) {
      setState({ kind: "quote_expired" });
      return;
    }

    setState({ kind: "authorising" });
    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch("/api/puente/payouts", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": workerWalletAddress,
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          idempotencyKey,
          workerWalletAddress,
          quoteExpiresAt: quote.expiresAt,
        }),
      });

      const body = await res.json() as {
        payoutReference?: string;
        sourceMode?: string;
        observedAt?: string;
        error?: string;
      };

      if (res.status === 422) {
        // Quote expired on server side
        setState({ kind: "quote_expired" });
        return;
      }

      if (!res.ok) {
        setState({
          kind: "error",
          message: body.error ?? `Unexpected status ${res.status} from server.`,
        });
        return;
      }

      setState({
        kind: "success",
        payoutReference: body.payoutReference ?? idempotencyKey,
        sourceMode: body.sourceMode ?? "FIXTURE",
        observedAt: body.observedAt ?? new Date().toISOString(),
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error while authorising payout.",
      });
    }
  }

  function handleGetNewQuote() {
    if (!workerWalletAddress) return;
    didFetchRef.current = false;
    setState({ kind: "fetching_quote" });
    void fetchQuote(workerWalletAddress);
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  if (state.kind === "idle") {
    return (
      <section className="bpc-card bpc-card--idle" aria-label="BOB payout card">
        <h3 className="bpc-title">Worker Payout (BOB)</h3>
        <div className="bpc-idle-reason" role="status">
          <Clock size={15} />
          <span>{state.reason}</span>
        </div>
      </section>
    );
  }

  if (state.kind === "fetching_quote") {
    return (
      <section className="bpc-card bpc-card--loading" aria-label="BOB payout card" aria-busy="true">
        <Loader2 size={18} className="animate-spin" />
        <span>Fetching payout quote…</span>
      </section>
    );
  }

  if (state.kind === "quote_expired") {
    return (
      <section className="bpc-card bpc-card--expired" aria-label="BOB payout card">
        <h3 className="bpc-title">Worker Payout (BOB)</h3>
        <div className="bpc-expired" role="alert">
          <AlertCircle size={18} />
          <p>This quote has expired. Get a new one to continue.</p>
          {workerWalletAddress && (
            <Button size="sm" variant="outline" onClick={handleGetNewQuote}>
              Get new quote
            </Button>
          )}
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="bpc-card bpc-card--error" aria-label="BOB payout card">
        <h3 className="bpc-title">Worker Payout (BOB)</h3>
        <div className="bpc-error" role="alert">
          <AlertCircle size={18} />
          <p>{state.message}</p>
          {workerWalletAddress && (
            <Button size="sm" variant="outline" onClick={handleGetNewQuote}>
              Try again
            </Button>
          )}
        </div>
      </section>
    );
  }

  if (state.kind === "success") {
    return (
      <section className="bpc-card bpc-card--success" aria-label="BOB payout card">
        <div className="bpc-header">
          <h3 className="bpc-title">Worker Payout (BOB)</h3>
          {/* sourceMode badge — ALWAYS visible */}
          <span className="bpc-badge bpc-badge--mode" aria-label={`Source mode: ${state.sourceMode}`}>
            {state.sourceMode}
          </span>
        </div>
        <div className="bpc-success" role="status">
          <CheckCircle2 size={20} />
          <div>
            <p>
              <strong>Payout authorised</strong>
            </p>
            <p>
              Reference: <code>{state.payoutReference}</code>
            </p>
            <p className="bpc-sim-notice">
              Testnet simulation — no real BOB payout was made.
              Stereum would be called in production to settle this payout.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // quote_ready or authorising
  const quote = state.kind === "quote_ready" ? state.quote : null;
  const isAuthorising = state.kind === "authorising";
  const displayQuote = quote ?? (state.kind === "authorising" ? null : null);

  // For authorising state we keep the last quote visible — use a ref to preserve it.
  // Since state transitions discard the quote object, we render the authorising
  // spinner over the card without the quote details.
  if (isAuthorising) {
    return (
      <section className="bpc-card bpc-card--loading" aria-label="BOB payout card" aria-busy="true">
        <Loader2 size={18} className="animate-spin" />
        <span>Authorising payout…</span>
      </section>
    );
  }

  // quote_ready
  const q = (state as { kind: "quote_ready"; quote: PayoutQuote }).quote;

  return (
    <section className="bpc-card" aria-label="BOB payout card">
      {/* Header row */}
      <div className="bpc-header">
        <h3 className="bpc-title">Worker Payout (BOB)</h3>
        {/* sourceMode badge — ALWAYS visible */}
        <span className="bpc-badge bpc-badge--mode" aria-label={`Source mode: ${q.sourceMode}`}>
          {q.sourceMode}
        </span>
      </div>

      {/* Quote details */}
      <div className="bpc-quote-details">
        <div className="bpc-detail-row">
          <span className="bpc-label">You send</span>
          <span className="bpc-value">{formatUsdc(q.feeBaseUnits)}</span>
        </div>
        <div className="bpc-detail-row">
          <span className="bpc-label">You receive</span>
          <span className="bpc-value">{formatBob(q.bobMinorUnits)}</span>
        </div>
        <div className="bpc-detail-row">
          <span className="bpc-label">Fee</span>
          <span className="bpc-value">{formatUsdc(q.feeBaseUnits)}</span>
        </div>
        <div className="bpc-detail-row">
          <span className="bpc-label">Exchange rate</span>
          <span className="bpc-value">{q.exchangeRate} USDC/BOB</span>
        </div>
      </div>

      {/* Expiry countdown */}
      <div className="bpc-expiry-row">
        <ExpiryCountdown expiresAt={q.expiresAt} />
      </div>

      <p className="bpc-disclaimer">
        Testnet simulation — no real BOB payout
      </p>

      <div className="bpc-actions">
        <Button
          onClick={() => { void authorisePayout(q); }}
          disabled={isAuthorising}
        >
          Authorise Payout
        </Button>
      </div>
    </section>
  );
}
