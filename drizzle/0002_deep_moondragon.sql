CREATE TYPE "public"."probe_status" AS ENUM('open', 'answered', 'dismissed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mentor_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"question" text NOT NULL,
	"rationale" text,
	"dimension" "insight_dimension",
	"status" "probe_status" DEFAULT 'open' NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_probes" ADD CONSTRAINT "mentor_probes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_probes" ADD CONSTRAINT "mentor_probes_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
