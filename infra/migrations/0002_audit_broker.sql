-- Add extended fields to audit_jobs for paid audit broker (Section 20.1).
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "tarball_digest" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "evidence_bundle" jsonb;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "provider_job_id" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD COLUMN "updated_at" timestamptz DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "aj_version_idx" ON "safenpm"."audit_jobs" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "aj_status_idx" ON "safenpm"."audit_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "aj_idem_idx" ON "safenpm"."audit_jobs" USING btree ("idempotency_key");--> statement-breakpoint

-- Add extended fields to audit_attestations for paid audit broker (Section 20.1).
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "tarball_digest" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "provider_version" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "judgment" text;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "score_adjustment" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "signed_at" timestamptz;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD COLUMN "public_key_id" text;--> statement-breakpoint
CREATE INDEX "aa_version_idx" ON "safenpm"."audit_attestations" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "aa_digest_idx" ON "safenpm"."audit_attestations" USING btree ("tarball_digest");--> statement-breakpoint
CREATE INDEX "aa_job_idx" ON "safenpm"."audit_attestations" USING btree ("audit_job_id");--> statement-breakpoint

-- Payment ledger tables (Section 20.4).
CREATE TABLE "safenpm"."billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "safenpm"."billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ba_user_idx" ON "safenpm"."billing_accounts" USING btree ("user_id");--> statement-breakpoint

CREATE TYPE "safenpm"."ledger_entry_type" AS ENUM('credit', 'debit', 'refund', 'reserve', 'capture');--> statement-breakpoint
CREATE TABLE "safenpm"."ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"audit_job_id" uuid,
	"type" "safenpm"."ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"description" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "safenpm"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "safenpm"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."ledger_entries" ADD CONSTRAINT "ledger_entries_audit_job_id_audit_jobs_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "safenpm"."audit_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "le_account_idx" ON "safenpm"."ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "le_idem_idx" ON "safenpm"."ledger_entries" USING btree ("idempotency_key");
