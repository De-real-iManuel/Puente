import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  authSubject: text("auth_subject").notNull().unique(),
  createdAt: createdAt(),
});

export const workerProfiles = pgTable("worker_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  countryDeclaration: text("country_declaration").notNull(),
  languages: jsonb("languages").notNull(),
  available: boolean("available").notNull().default(false),
  walletReference: text("wallet_reference"),
});

export const taskIntents = pgTable("task_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull().references(() => users.id),
  schemaVersion: integer("schema_version").notNull(),
  content: jsonb("content").notNull(),
  locale: text("locale").notNull(),
  requirements: jsonb("requirements").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("task_buyer_created_idx").on(t.buyerId, t.createdAt)]);

export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => taskIntents.id),
  workerId: uuid("worker_id").notNull().references(() => users.id),
  status: text("status").notNull(),
  terms: jsonb("terms").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("reservation_task_unique").on(t.taskId)]);

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id").notNull().references(() => reservations.id).unique(),
  buyerId: uuid("buyer_id").notNull().references(() => users.id),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  amountBaseUnits: bigint("amount_base_units", { mode: "bigint" }).notNull(),
  network: text("network").notNull(),
  assetId: text("asset_id").notNull(),
  assetDecimals: integer("asset_decimals").notNull(),
  recipient: text("recipient").notNull(),
  sourceMode: text("source_mode").notNull(),
  status: text("status").notNull(),
  fundingOrderId: uuid("funding_order_id").references(() => fundingOrders.id),
  debitedBaseUnits: bigint("debited_base_units", { mode: "bigint" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("purchase_buyer_key_unique").on(t.buyerId, t.idempotencyKey)]);

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseId: uuid("purchase_id").notNull().references(() => purchases.id),
  providerReference: text("provider_reference").notNull(),
  network: text("network").notNull(),
  recipient: text("recipient").notNull(),
  observedBaseUnits: bigint("observed_base_units", { mode: "bigint" }).notNull(),
  status: text("status").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  observedAt: createdAt(),
}, (t) => [uniqueIndex("settlement_network_provider_unique").on(t.network, t.providerReference)]);

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => taskIntents.id),
  workerId: uuid("worker_id").notNull().references(() => users.id),
  version: integer("version").notNull(),
  result: jsonb("result").notNull(),
  submittedAt: createdAt(),
}, (t) => [uniqueIndex("submission_task_version_unique").on(t.taskId, t.version)]);

export const fundingOrders = pgTable("funding_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull().references(() => users.id),
  ngnMinorUnits: bigint("ngn_minor_units", { mode: "bigint" }).notNull(),
  expectedAssetUnits: bigint("expected_asset_units", { mode: "bigint" }).notNull(),
  rate: text("rate").notNull(),
  feeMinorUnits: bigint("fee_minor_units", { mode: "bigint" }).notNull(),
  mode: text("mode").notNull(),
  externalReference: text("external_reference"),
  status: text("status").notNull(), // INSTRUCTIONS_ISSUED | FIAT_CONFIRMED | RELEASE_PENDING | ASSET_CONFIRMED | EXPIRED | FAILED
  providerReference: text("provider_reference").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
  ngnReceiptReference: text("ngn_receipt_reference"),
  releaseReference: text("release_reference"),
  stellarTxReference: text("stellar_tx_reference"),
  sourceMode: text("source_mode").notNull().default("MANUAL"),
  bankAccountName: text("bank_account_name"),
  accountNumber: text("account_number"),
  bankName: text("bank_name"),
  createdAt: createdAt(),
});

export const agentBudgets = pgTable("agent_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull().unique().references(() => users.id),
  balanceBaseUnits: bigint("balance_base_units", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payoutOrders = pgTable("payout_orders", {
  id: uuid("id").primaryKey().defaultRandom(), workerId: uuid("worker_id").notNull().references(() => users.id),
  quoteId: text("quote_id").notNull(), quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }).notNull(),
  assetBaseUnits: bigint("asset_base_units", { mode: "bigint" }).notNull(), bobMinorUnits: bigint("bob_minor_units", { mode: "bigint" }).notNull(),
  feeBaseUnits: bigint("fee_base_units", { mode: "bigint" }).notNull(), providerReference: text("provider_reference").unique(),
  sourceMode: text("source_mode").notNull(), status: text("status").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  taskId: uuid("task_id").references(() => taskIntents.id),
  exchangeRate: text("exchange_rate").notNull().default(""),
  workerWallet: text("worker_wallet").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("payout_worker_key_unique").on(t.workerId, t.idempotencyKey)]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(), provider: text("provider").notNull(), eventId: text("event_id").notNull(),
  payloadDigest: text("payload_digest").notNull(), verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex("webhook_provider_event_unique").on(t.provider, t.eventId)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(), aggregateId: text("aggregate_id").notNull(), event: text("event").notNull(),
  actor: text("actor").notNull(), sourceMode: text("source_mode").notNull(), metadata: jsonb("metadata").notNull(), createdAt: createdAt(),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(), kind: text("kind").notNull(), aggregateId: text("aggregate_id").notNull(),
  status: text("status").notNull().default("READY"), attempts: integer("attempts").notNull().default(0),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(), leaseUntil: timestamp("lease_until", { withTimezone: true }),
  payload: jsonb("payload").notNull(), createdAt: createdAt(),
}, (t) => [uniqueIndex("job_active_dedupe_unique").on(t.kind, t.aggregateId, t.status), index("job_poll_idx").on(t.status, t.runAfter)]);
