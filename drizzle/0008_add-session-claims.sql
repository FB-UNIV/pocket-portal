CREATE TABLE "session_claims" (
	"subject" text PRIMARY KEY NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"attempted_at" timestamp with time zone NOT NULL
);
