import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
export type Message = {
  role: "user" | "assistant";
  content: string;
  at: string;
};
export type Offer = {
  id: string;
  text: string;
  reason: string;
  amountCents: number;
  expiresAt: string;
};
export type Task = {
  id: string;
  sessionId: string;
  text: string;
  reason: string;
  amountCents: number;
  reviewerHash: string;
  status: "open" | "reserved" | "payment_pending" | "working" | "submitted";
  payment: "unpaid" | "confirmed" | "unknown";
  payout: "not_requested" | "authorization_required" | "submitted" | "processing" | "paid" | "failed" | "unknown";
  reservationExpiresAt?: string;
  purchaseId?: string;
  purchaseKey?: string;
  purchaseRequestHash?: string;
  settlementReference?: string;
  correction?: string;
  explanation?: string;
  createdAt: string;
  submittedAt?: string;
  paidAt?: string;
  payoutAt?: string;
  incorporated?: boolean;
};
export type Session = {
  id: string;
  messages: Message[];
  offer?: Offer;
  taskId?: string;
  createdAt: string;
  authorizedLive: boolean;
};
export const token = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();
export class Store {
  sessions: Record<string, Session> = {};
  tasks: Record<string, Task> = {};
  private filename: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.filename = path.join(directory, "puente.json");
    try {
      const d = JSON.parse(readFileSync(this.filename, "utf8"));
      this.sessions = d.sessions ?? {};
      this.tasks = d.tasks ?? {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Cannot read Puente state. Restore the data file before restarting.",
        );
    }
  }
  save() {
    writeFileSync(
      this.filename + ".tmp",
      JSON.stringify({ sessions: this.sessions, tasks: this.tasks }),
      { mode: 0o600 },
    );
    renameSync(this.filename + ".tmp", this.filename);
  }
  create(authorizedLive = false) {
    const secret = token();
    const id = hash(secret);
    this.sessions[id] = { id, messages: [], createdAt: now(), authorizedLive };
    this.save();
    return { secret, session: this.sessions[id] };
  }
  prune() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, s] of Object.entries(this.sessions))
      if (Date.parse(s.createdAt) < cutoff) {
        delete this.sessions[id];
        for (const [taskId, t] of Object.entries(this.tasks))
          if (t.sessionId === id) delete this.tasks[taskId];
      }
    this.save();
  }
}
export const publicTask = (t?: Task) =>
  t
    ? {
        id: t.id,
        text: t.text,
        reason: t.reason,
        amountCents: t.amountCents,
        status: t.status,
        payment: t.payment,
        payout: t.payout,
        correction: t.correction,
        explanation: t.explanation,
        createdAt: t.createdAt,
        submittedAt: t.submittedAt,
        paidAt: t.paidAt,
        payoutAt: t.payoutAt,
        incorporated: t.incorporated,
        reservationExpiresAt: t.reservationExpiresAt,
        purchaseId: t.purchaseId,
        settlementReference: t.settlementReference,
        mode: "LIVE",
      }
    : null;
