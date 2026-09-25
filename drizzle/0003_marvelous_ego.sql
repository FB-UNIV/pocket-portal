CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_subject" text NOT NULL,
	"requester_email" text,
	"pocket_id_client_id" text NOT NULL,
	"pocket_id_group_id" text NOT NULL,
	"pocket_id_group_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
