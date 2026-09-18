export type Message = {
  role: "user" | "assistant";
  content: string;
  at: string;
};
export type Task = {
  id: string;
  text: string;
  reason: string;
  amountCents: number;
  status: "open" | "reserved" | "payment_pending" | "working" | "submitted";
  payment: "unpaid" | "confirmed" | "unknown";
  payout: "not_requested" | "authorization_required" | "submitted" | "processing" | "paid" | "failed" | "unknown";
  correction?: string;
  explanation?: string;
  incorporated?: boolean;
  reservationExpiresAt?: string;
  settlementReference?: string;
};
export type Conversation = {
  messages: Message[];
  offer: {
    id: string;
    text: string;
    reason: string;
    amountCents: number;
    expiresAt: string;
  } | null;
  task: Task | null;
  chatMode: "live";
  paymentMode: string;
  reviewerPath?: string;
};
export type Config = {
  chatMode: "live";
  paymentMode: string;
  accessRequired: boolean;
  pollarPublishableKey: string | null;
  pollarNetwork: "testnet" | "mainnet";
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  reviewerKey?: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const r = await fetch(`/api/puente${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(reviewerKey ? { Authorization: `Bearer ${reviewerKey}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r
    .json()
    .catch(() => ({ error: "Puente could not reach the server." }));
  if (!r.ok) throw new ApiError(d.error || "Please try again.", r.status);
  return d as T;
}
export const money = (cents: number) => (cents / 100).toFixed(2);


export type FundingState =
  | "INSTRUCTIONS_ISSUED"
  | "FIAT_CONFIRMED"
  | "RELEASE_PENDING"
  | "ASSET_CONFIRMED"
  | "EXPIRED"
  | "FAILED";

export type FundingOrder = {
  id: string;
  buyerId: string;
  ngnMinorUnits: string;
  expectedAssetBaseUnits: string;
  confirmedBaseUnits: string | null;
  status: FundingState;
  sourceMode: string;
  providerReference: string | null;
  expiresAt: string;
  bankAccountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  ngnReceiptReference: string | null;
  releaseReference: string | null;
  stellarTxReference: string | null;
  createdAt: string;
};

export async function createFundingOrder(
  ngnMinorUnits: string,
  expectedAssetBaseUnits: string,
): Promise<FundingOrder> {
  return api<FundingOrder>("/funding-orders", {
    ngnMinorUnits,
    expectedAssetBaseUnits,
  });
}

export async function getFundingOrder(id: string): Promise<FundingOrder> {
  return api<FundingOrder>(`/funding-orders/${id}`);
}
