CREATE TABLE "news_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_posts" ADD COLUMN "cover_image_id" uuid;--> statement-breakpoint
ALTER TABLE "news_images" ADD CONSTRAINT "news_images_post_id_news_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."news_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_cover_image_id_news_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."news_images"("id") ON DELETE set null ON UPDATE no action;