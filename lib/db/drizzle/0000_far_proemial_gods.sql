CREATE TABLE "agent_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"balance_base_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_budgets_buyer_id_unique" UNIQUE("buyer_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_id" text NOT NULL,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"source_mode" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"ngn_minor_units" bigint NOT NULL,
	"expected_asset_units" bigint NOT NULL,
	"rate" text NOT NULL,
	"fee_minor_units" bigint NOT NULL,
	"mode" text NOT NULL,
	"external_reference" text,
	"status" text NOT NULL,
	"provider_reference" text,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ngn_receipt_reference" text,
	"release_reference" text,
	"stellar_tx_reference" text,
	"source_mode" text DEFAULT 'MANUAL' NOT NULL,
	"bank_account_name" text,
	"account_number" text,
	"bank_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_orders_provider_reference_unique" UNIQUE("provider_reference")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"quote_id" text NOT NULL,
	"quote_expires_at" timestamp with time zone NOT NULL,
	"asset_base_units" bigint NOT NULL,
	"bob_minor_units" bigint NOT NULL,
	"fee_base_units" bigint NOT NULL,
	"provider_reference" text,
	"source_mode" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"task_id" uuid,
	"exchange_rate" text DEFAULT '' NOT NULL,
	"worker_wallet" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_orders_provider_reference_unique" UNIQUE("provider_reference")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"amount_base_units" bigint NOT NULL,
	"network" text NOT NULL,
	"asset_id" text NOT NULL,
	"asset_decimals" integer NOT NULL,
	"recipient" text NOT NULL,
	"source_mode" text NOT NULL,
	"status" text NOT NULL,
	"funding_order_id" uuid,
	"debited_base_units" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_reservation_id_unique" UNIQUE("reservation_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" text NOT NULL,
	"terms" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"network" text NOT NULL,
	"recipient" text NOT NULL,
	"observed_base_units" bigint NOT NULL,
	"status" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"locale" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_subject")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload_digest" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"country_declaration" text NOT NULL,
	"languages" jsonb NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"wallet_reference" text
);
--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD CONSTRAINT "agent_budgets_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_orders" ADD CONSTRAINT "funding_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_orders" ADD CONSTRAINT "payout_orders_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_orders" ADD CONSTRAINT "payout_orders_task_id_task_intents_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_funding_order_id_funding_orders_id_fk" FOREIGN KEY ("funding_order_id") REFERENCES "public"."funding_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_task_id_task_intents_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_task_intents_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intents" ADD CONSTRAINT "task_intents_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_active_dedupe_unique" ON "jobs" USING btree ("kind","aggregate_id","status");--> statement-breakpoint
CREATE INDEX "job_poll_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_worker_key_unique" ON "payout_orders" USING btree ("worker_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_buyer_key_unique" ON "purchases" USING btree ("buyer_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_task_unique" ON "reservations" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_network_provider_unique" ON "settlements" USING btree ("network","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_task_version_unique" ON "submissions" USING btree ("task_id","version");--> statement-breakpoint
CREATE INDEX "task_buyer_created_idx" ON "task_intents" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_provider_event_unique" ON "webhook_events" USING btree ("provider","event_id");