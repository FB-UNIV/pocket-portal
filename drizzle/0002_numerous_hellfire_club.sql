CREATE TABLE "app_overrides" (
	"pocket_id_client_id" text PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "apps" CASCADE;--> statement-breakpoint
DROP TYPE "public"."app_integration_status";