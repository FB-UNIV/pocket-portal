CREATE TABLE "app_dependencies" (
	"pocket_id_client_id" text NOT NULL,
	"requires_pocket_id_client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_dependencies_pocket_id_client_id_requires_pocket_id_client_id_pk" PRIMARY KEY("pocket_id_client_id","requires_pocket_id_client_id")
);
