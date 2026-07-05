ALTER TABLE "profiles" ADD COLUMN "linkedin_sub" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_linkedin_sub_unique" UNIQUE("linkedin_sub");