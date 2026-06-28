CREATE TYPE "safenpm"."stage_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "safenpm"."stage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"created_by" uuid,
	"status" "safenpm"."stage_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamptz,
	"rejected_by" uuid,
	"rejected_at" timestamptz,
	"review_notes" text
);--> statement-breakpoint
ALTER TABLE "safenpm"."stage_records" ADD CONSTRAINT "stage_records_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "safenpm"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."stage_records" ADD CONSTRAINT "stage_records_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "safenpm"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."stage_records" ADD CONSTRAINT "stage_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."stage_records" ADD CONSTRAINT "stage_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safenpm"."stage_records" ADD CONSTRAINT "stage_records_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "safenpm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sr_package_idx" ON "safenpm"."stage_records" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "sr_version_idx" ON "safenpm"."stage_records" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "sr_status_idx" ON "safenpm"."stage_records" USING btree ("status");
