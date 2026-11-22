CREATE TABLE "wheel_spins" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_spins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"round" integer NOT NULL,
	"slice_key" text NOT NULL,
	"prize" jsonb NOT NULL,
	"status" text DEFAULT 'spun' NOT NULL,
	"user_id" text,
	"bound_via" text,
	"coupon_id" integer,
	"locale" text DEFAULT 'tr' NOT NULL,
	"ip_hash" text,
	"page_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	CONSTRAINT "wheel_spins_status_check" CHECK ("wheel_spins"."status" in ('spun', 'bound', 'claimed', 'expired')),
	CONSTRAINT "wheel_spins_bound_via_check" CHECK ("wheel_spins"."bound_via" is null or "wheel_spins"."bound_via" in ('register', 'sign_in', 'signed_in')),
	CONSTRAINT "wheel_spins_page_path_check" CHECK ("wheel_spins"."page_path" is null or char_length("wheel_spins"."page_path") <= 200)
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "poster_id" integer;--> statement-breakpoint
ALTER TABLE "product_media" ADD COLUMN "autoplay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wheel_spins_user_id_index" ON "wheel_spins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wheel_spins_created_at_index" ON "wheel_spins" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_spins_user_round_unique" ON "wheel_spins" USING btree ("user_id","round") WHERE "wheel_spins"."user_id" is not null and "wheel_spins"."status" in ('bound', 'claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_spins_coupon_unique" ON "wheel_spins" USING btree ("coupon_id") WHERE "wheel_spins"."coupon_id" is not null;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_poster_id_index" ON "media" USING btree ("poster_id");--> statement-breakpoint
CREATE INDEX "coupons_source_index" ON "coupons" USING btree ("source");--> statement-breakpoint
CREATE INDEX "coupons_user_id_index" ON "coupons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_coupon_id_index" ON "orders" USING btree ("coupon_id");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_kind_check" CHECK ("media"."kind" in ('image', 'video'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_kind_mime_check" CHECK (("media"."kind" = 'video') = ("media"."mime" like 'video/%'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_source_check" CHECK ("coupons"."source" in ('manual', 'wheel'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_wheel_owner_check" CHECK ("coupons"."source" <> 'wheel' or "coupons"."user_id" is not null);