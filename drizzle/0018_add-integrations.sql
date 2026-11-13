CREATE TABLE "integrations" (
	"type" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"linked_client_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
