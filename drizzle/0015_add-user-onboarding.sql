CREATE TABLE "user_onboarding" (
	"subject" text PRIMARY KEY NOT NULL,
	"checklist_dismissed_at" timestamp with time zone,
	"ticked_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tour_completed_at" timestamp with time zone,
	"tour_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
