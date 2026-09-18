import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, type FundingOrder, type FundingState } from "@/lib/puente-api";
const logo = "/favicon.svg";
import "./chat.css";

// ---------------------------------------------------------------------------
// Monetary helpers
// ---------------------------------------------------------------------------

function formatNaira(kobo: string): string {
  const koboInt = BigInt(kobo);
  const whole = koboInt / 100n;
  const frac = koboInt % 100n;
  const commaWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${commaWhole}.${frac.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Expiry countdown
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
      <span className="nfc-expiry nfc-expiry--expired">
        <Clock size={13} /> Expired
      </span>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className={`nfc-expiry${remaining < 120 ? " nfc-expiry--urgent" : ""}`}>
      <Clock size={13} /> {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// State badge colours / labels (mirrors NigerianFundingCard)
// ---------------------------------------------------------------------------

const STATE_CLASSES: Record<FundingState, string> = {
  INSTRUCTIONS_ISSUED: "nfc-badge--blue",
  FIAT_CONFIRMED: "nfc-badge--amber",
  RELEASE_PENDING: "nfc-badge--amber",
  ASSET_CONFIRMED: "nfc-badge--green",
  EXPIRED: "nfc-badge--red",
  FAILED: "nfc-badge--red",
};

const STATE_LABELS: Record<FundingState, string> = {
  INSTRUCTIONS_ISSUED: "Awaiting payment",
  FIAT_CONFIRMED: "NGN received",
  RELEASE_PENDING: "Releasing USDC",
  ASSET_CONFIRMED: "USDC confirmed",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

// ---------------------------------------------------------------------------
// Operator API helpers
// ---------------------------------------------------------------------------

async function operatorFetch<T>(
  path: string,
  secret: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/puente${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await r
    .json()
    .catch(() => ({ error: "Could not reach the server." }));

  if (!r.ok) {
    const msg =
      r.status === 403
        ? "Invalid operator secret."
        : (data as { error?: string }).error ?? "Request failed.";
    throw new ApiError(msg, r.status);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Order action row component
// ---------------------------------------------------------------------------

interface OrderRowProps {
  order: FundingOrder;
  secret: string;
  onUpdated: (order: FundingOrder) => void;
}

function OrderRow({ order, secret, onUpdated }: OrderRowProps) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [stellarRef, setStellarRef] = useState("");
  const [confirmedUnits, setConfirmedUnits] = useState("");

  const isFinal =
    order.status === "ASSET_CONFIRMED" ||
    order.status === "EXPIRED" ||
    order.status === "FAILED";

  async function runAction(action: () => Promise<FundingOrder>) {
    if (busy) return;
    setBusy(true);
    setRowError("");
    try {
      const updated = await action();
      onUpdated(updated);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  function confirmReceipt() {
    if (receiptRef.length < 1 || receiptRef.length > 100) {
      setRowError("Receipt reference must be between 1 and 100 characters.");
      return;
    }
    void runAction(() =>
      operatorFetch<FundingOrder>(`/operator/funding/${order.id}/confirm`, secret, {
        ngnReceiptReference: receiptRef,
      }),
    );
  }

  function release() {
    void runAction(() =>
      operatorFetch<FundingOrder>(`/operator/funding/${order.id}/release`, secret, {}),
    );
  }

  function assetConfirmed() {
    if (!stellarRef.trim()) {
      setRowError("Stellar tx reference is required.");
      return;
    }
    if (!/^(0|[1-9]\d*)$/.test(confirmedUnits)) {
      setRowError("Confirmed base units must be a non-negative integer.");
      return;
    }
    void runAction(() =>
      operatorFetch<FundingOrder>(`/operator/funding/${order.id}/asset-confirmed`, secret, {
        stellarTxReference: stellarRef,
        confirmedBaseUnits: confirmedUnits,
      }),
    );
  }

  return (
    <div className="op-order-row">
      {/* Header */}
      <div className="op-order-header">
        <div className="op-order-meta">
          <span className="op-order-id" title={order.buyerId}>
            {order.buyerId.slice(0, 8)}…
          </span>
          <span className="op-order-amount">{formatNaira(order.ngnMinorUnits)}</span>
          {!isFinal && <ExpiryCountdown expiresAt={order.expiresAt} />}
        </div>
        <div className="nfc-badges">
          <span className="nfc-badge nfc-badge--mode">{order.sourceMode}</span>
          <span className={`nfc-badge ${STATE_CLASSES[order.status]}`}>
            {STATE_LABELS[order.status]}
          </span>
        </div>
      </div>

      {/* Provider reference */}
      {order.providerReference && (
        <p className="op-order-ref">
          <span className="nfc-label">Ref:</span>{" "}
          <code>{order.providerReference}</code>
        </p>
      )}

      {/* ASSET_CONFIRMED success */}
      {order.status === "ASSET_CONFIRMED" && (
        <div className="op-success">
          <CheckCircle2 size={15} />
          <span>
            USDC confirmed
            {order.confirmedBaseUnits ? ` — ${order.confirmedBaseUnits} base units` : ""}
          </span>
          {order.stellarTxReference && (
            <code className="op-tx">{order.stellarTxReference}</code>
          )}
        </div>
      )}

      {/* Actions */}
      {order.status === "INSTRUCTIONS_ISSUED" && (
        <div className="op-action-group">
          <Input
            type="text"
            placeholder="NGN receipt reference (1–100 chars)"
            value={receiptRef}
            onChange={(e) => setReceiptRef(e.target.value)}
            maxLength={100}
            disabled={busy}
            aria-label="NGN receipt reference"
          />
          <Button size="sm" disabled={busy || receiptRef.length === 0} onClick={confirmReceipt}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirm Receipt
          </Button>
        </div>
      )}

      {order.status === "FIAT_CONFIRMED" && (
        <div className="op-action-group">
          <Button size="sm" disabled={busy} onClick={release}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Release USDC
          </Button>
        </div>
      )}

      {order.status === "RELEASE_PENDING" && (
        <div className="op-action-group">
          <Input
            type="text"
            placeholder="Stellar tx reference"
            value={stellarRef}
            onChange={(e) => setStellarRef(e.target.value)}
            disabled={busy}
            aria-label="Stellar tx reference"
          />
          <Input
            type="text"
            placeholder="Confirmed base units (integer)"
            value={confirmedUnits}
            onChange={(e) => setConfirmedUnits(e.target.value)}
            disabled={busy}
            aria-label="Confirmed base units"
          />
          <Button
            size="sm"
            disabled={busy || !stellarRef.trim() || !confirmedUnits.trim()}
            onClick={assetConfirmed}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Mark Asset Confirmed
          </Button>
        </div>
      )}

      {rowError && (
        <p className="op-row-error" role="alert">
          <AlertCircle size={13} /> {rowError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main operator page
// ---------------------------------------------------------------------------

export default function Operator() {
  // Secret is held in state only — never stored in localStorage / sessionStorage
  const [secretInput, setSecretInput] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const [orders, setOrders] = useState<FundingOrder[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = useCallback(
    async (s: string) => {
      try {
        const data = await operatorFetch<FundingOrder[]>("/operator/funding-orders", s);
        setOrders(data);
        setListError("");
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Could not fetch orders.");
      }
    },
    [],
  );

  // Start / stop polling when secret changes
  useEffect(() => {
    if (!secret) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setOrders([]);
      setListError("");
      return;
    }

    void fetchOrders(secret);
    intervalRef.current = setInterval(() => void fetchOrders(secret), 10_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [secret, fetchOrders]);

  async function connect() {
    if (!secretInput.trim()) return;
    setLoading(true);
    setListError("");
    try {
      // Verify credentials by fetching orders immediately
      const data = await operatorFetch<FundingOrder[]>(
        "/operator/funding-orders",
        secretInput,
      );
      setOrders(data);
      setSecret(secretInput);
      setSecretInput(""); // clear input so secret isn't visible after login
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  }

  function disconnect() {
    setSecret(null);
    setSecretInput("");
    setOrders([]);
    setListError("");
  }

  function handleOrderUpdated(updated: FundingOrder) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  // ------ Login screen ------
  if (!secret) {
    return (
      <div className="chat-shell">
        <header className="chat-header">
          <a href="/" className="chat-brand">
            <img src={logo} alt="" />
            puente<span>.</span>
          </a>
          <span className="mode-label">Operator panel</span>
        </header>
        <main className="op-main">
          <div className="op-login-card">
            <ShieldCheck size={28} className="op-login-icon" />
            <h1>Operator access</h1>
            <p>Enter your operator secret to manage funding orders.</p>
            {listError && (
              <div className="chat-error" role="alert">
                <AlertCircle size={15} /> {listError}
              </div>
            )}
            <form
              className="op-login-form"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder="Operator secret"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                disabled={loading}
                aria-label="Operator secret"
              />
              <Button
                type="submit"
                disabled={loading || !secretInput.trim()}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Connect as Operator
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // ------ Orders list ------
  return (
    <div className="chat-shell">
      <header className="chat-header">
        <a href="/" className="chat-brand">
          <img src={logo} alt="" />
          puente<span>.</span>
        </a>
        <div className="header-actions">
          <span className="mode-label">Operator panel</span>
          <Button variant="outline" size="sm" onClick={disconnect}>
            <LogOut size={15} /> Disconnect
          </Button>
        </div>
      </header>
      <main className="op-main">
        <div className="op-list-header">
          <h1>Funding orders</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchOrders(secret)}
            aria-label="Refresh orders"
          >
            <RefreshCw size={15} />
          </Button>
        </div>

        {listError && (
          <div className="chat-error" role="alert">
            <AlertCircle size={15} /> {listError}
          </div>
        )}

        {orders.length === 0 && !listError && (
          <p className="op-empty">No funding orders found.</p>
        )}

        <div className="op-orders">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              secret={secret}
              onUpdated={handleOrderUpdated}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
