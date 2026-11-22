ALTER TABLE "media" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "locale" text DEFAULT 'tr' NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_user_id_created_at_index" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "redirects_to_path_index" ON "redirects" USING btree ("to_path");--> statement-breakpoint
CREATE UNIQUE INDEX "themes_single_default" ON "themes" USING btree ("is_default") WHERE "themes"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_upper_unique" ON "product_variants" USING btree (upper("sku"));--> statement-breakpoint
CREATE INDEX "contact_messages_is_read_created_at_index" ON "contact_messages" USING btree ("is_read","created_at");--> statement-breakpoint
CREATE INDEX "contact_messages_created_at_index" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_one_current" ON "legal_documents" USING btree ("key") WHERE "legal_documents"."is_current";