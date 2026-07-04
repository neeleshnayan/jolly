CREATE TYPE "public"."opportunity_source" AS ENUM('greenhouse', 'lever', 'ashby', 'pasted', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "opportunity_source" DEFAULT 'pasted' NOT NULL,
	"external_id" text,
	"url" text,
	"company" text,
	"title" text,
	"location" text,
	"remote" text,
	"comp_min" integer,
	"comp_max" integer,
	"company_stage" text,
	"domain" text,
	"raw_text" text,
	"vector" jsonb DEFAULT '{}'::jsonb,
	"facts" jsonb DEFAULT '{}'::jsonb,
	"added_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_added_by_profile_id_profiles_id_fk" FOREIGN KEY ("added_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
