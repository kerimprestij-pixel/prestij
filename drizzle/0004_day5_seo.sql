ALTER TABLE "categories" ADD COLUMN "body" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "faq" jsonb DEFAULT '[]'::jsonb NOT NULL;