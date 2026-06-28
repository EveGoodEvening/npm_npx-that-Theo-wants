CREATE SCHEMA "safenpm";
--> statement-breakpoint
CREATE TYPE "public"."audit_job_mode" AS ENUM('basic', 'paid', 'byo_advisory');--> statement-breakpoint
CREATE TYPE "public"."audit_job_status" AS ENUM('queued', 'running', 'passed', 'warned', 'failed', 'errored', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."install_event_type" AS ENUM('manifest_resolve', 'tarball_fetch', 'exec_preflight', 'install_success');--> statement-breakpoint
CREATE TYPE "public"."package_visibility" AS ENUM('private', 'public', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."policy_scope_type" AS ENUM('user', 'org', 'project', 'ci', 'agent');--> statement-breakpoint
CREATE TYPE "public"."retraction_mode" AS ENUM('threshold_retract', 'admin_quarantine', 'policy_yank');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('excellent', 'good', 'caution', 'danger', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('private', 'staged_public', 'public', 'retracted', 'deprecated', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TABLE "safenpm"."audit_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"statement_type" text NOT NULL,
	"signed_payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"transparency_log_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."audit_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"requester_user_id" uuid,
	"provider_id" uuid,
	"mode" text DEFAULT 'basic' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "safenpm"."auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."dist_tags" (
	"package_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"version" text NOT NULL,
	"publish_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dist_tags_package_id_tag_pk" PRIMARY KEY("package_id","tag")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."install_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_version_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"privacy_bucket" text NOT NULL,
	"user_agent_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."install_rollups" (
	"package_version_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"unique_install_count" integer DEFAULT 0 NOT NULL,
	"tarball_fetch_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "install_rollups_package_version_id_window_start_window_end_pk" PRIMARY KEY("package_version_id","window_start","window_end")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_visibility" text DEFAULT 'private' NOT NULL,
	"policy_id" uuid,
	CONSTRAINT "orgs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"version" text NOT NULL,
	"publish_id" uuid NOT NULL,
	"status" text DEFAULT 'private' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publisher_user_id" uuid,
	"tarball_object_key" text NOT NULL,
	"tarball_sha512" text NOT NULL,
	"tarball_shasum" text,
	"unpacked_size_bytes" bigint,
	"file_count" integer,
	"provenance_status" text,
	"source_repository_url" text,
	"source_commit_sha" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text,
	"owner_org_id" uuid,
	"owner_user_id" uuid,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name_risk" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."permission_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"declared_permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inferred_permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enforceability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."policy_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."risk_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"tier" text NOT NULL,
	"confidence" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzer_version" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safenpm"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"passkey_enabled" boolean DEFAULT false NOT NULL,
	"risk_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."version_aliases" (
	"package_id" uuid NOT NULL,
	"version" text NOT NULL,
	"active_publish_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "version_aliases_package_id_version_pk" PRIMARY KEY("package_id","version")
);
--> statement-breakpoint
CREATE TABLE "safenpm"."version_retractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"reason" text NOT NULL,
	"mode" text NOT NULL,
	"observed_installs_at_retract" integer DEFAULT 0 NOT NULL,
	"age_seconds_at_retract" integer DEFAULT 0 NOT NULL,
	"semver_reuse_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD CONSTRAINT "audit_attestations_audit_job_id_audit_jobs_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "safenpm"."audit_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_attestations" ADD CONSTRAINT "audit_attestations_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD CONSTRAINT "audit_jobs_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."audit_jobs" ADD CONSTRAINT "audit_jobs_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."dist_tags" ADD CONSTRAINT "dist_tags_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "safenpm"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."install_events" ADD CONSTRAINT "install_events_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."install_rollups" ADD CONSTRAINT "install_rollups_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "safenpm"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "safenpm"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."package_versions" ADD CONSTRAINT "package_versions_publisher_user_id_users_id_fk" FOREIGN KEY ("publisher_user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."packages" ADD CONSTRAINT "packages_owner_org_id_orgs_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "safenpm"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."packages" ADD CONSTRAINT "packages_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."permission_reports" ADD CONSTRAINT "permission_reports_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."risk_reports" ADD CONSTRAINT "risk_reports_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."version_aliases" ADD CONSTRAINT "version_aliases_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "safenpm"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."version_retractions" ADD CONSTRAINT "version_retractions_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."version_retractions" ADD CONSTRAINT "version_retractions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "at_user_idx" ON "safenpm"."auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "at_token_hash_idx" ON "safenpm"."auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ie_version_idx" ON "safenpm"."install_events" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "ie_created_idx" ON "safenpm"."install_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pv_package_idx" ON "safenpm"."package_versions" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "pv_publish_id_idx" ON "safenpm"."package_versions" USING btree ("publish_id");--> statement-breakpoint
CREATE INDEX "pv_status_idx" ON "safenpm"."package_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "packages_scope_idx" ON "safenpm"."packages" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "packages_owner_org_idx" ON "safenpm"."packages" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "packages_owner_user_idx" ON "safenpm"."packages" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ps_scope_idx" ON "safenpm"."policy_sets" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "rr_version_idx" ON "safenpm"."risk_reports" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "rr_digest_idx" ON "safenpm"."risk_reports" USING btree ("evidence_digest");