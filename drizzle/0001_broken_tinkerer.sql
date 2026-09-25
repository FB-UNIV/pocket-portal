CREATE TYPE "public"."app_integration_status" AS ENUM('not_integrated', 'oidc');--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"launch_url" text NOT NULL,
	"pocket_id_group_id" text NOT NULL,
	"integration_status" "app_integration_status" DEFAULT 'not_integrated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
