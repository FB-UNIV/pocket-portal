CREATE TABLE "user_preferences" (
	"subject" text PRIMARY KEY NOT NULL,
	"locale" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
