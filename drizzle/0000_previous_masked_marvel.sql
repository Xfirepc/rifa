CREATE TABLE "audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_role" text NOT NULL,
	"actor_vendor_id" integer,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"prize_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"ticket_number" integer NOT NULL,
	"participant_id" integer NOT NULL,
	"kind" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "extractions_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "extraction_kind" CHECK ("extractions"."kind" in ('eliminated','winner'))
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"share_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_phone_unique" UNIQUE("phone"),
	CONSTRAINT "participants_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_path" text,
	"sort_order" integer NOT NULL,
	"draw_count" integer DEFAULT 5 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"winner_participant_id" integer,
	"winner_ticket_number" integer,
	CONSTRAINT "prize_count_positive" CHECK ("prizes"."draw_count" > 0),
	CONSTRAINT "prize_state" CHECK ("prizes"."state" in ('pending','active','awarded','unawarded'))
);
--> statement-breakpoint
CREATE TABLE "raffle" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'Mi Rifa' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "single_raffle" CHECK ("raffle"."id" = 1),
	CONSTRAINT "raffle_status" CHECK ("raffle"."status" in ('open','drawing','finished'))
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"ticket_number" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "price_positive" CHECK ("sale_items"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"participant_id" integer NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"vendor_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"number" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "ticket_range" CHECK ("tickets"."number" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quota" integer DEFAULT 50 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_quota_nonnegative" CHECK ("vendors"."quota" >= 0)
);
--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_prize_id_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."prizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_ticket_number_tickets_number_fk" FOREIGN KEY ("ticket_number") REFERENCES "public"."tickets"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_winner_participant_id_participants_id_fk" FOREIGN KEY ("winner_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_winner_ticket_number_tickets_number_fk" FOREIGN KEY ("winner_ticket_number") REFERENCES "public"."tickets"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_ticket_number_tickets_number_fk" FOREIGN KEY ("ticket_number") REFERENCES "public"."tickets"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prize_ordinal_unique" ON "extractions" USING btree ("prize_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "extracted_ticket_unique" ON "extractions" USING btree ("ticket_number");--> statement-breakpoint
CREATE UNIQUE INDEX "winner_participant_unique" ON "extractions" USING btree ("participant_id") WHERE "extractions"."kind" = 'winner';--> statement-breakpoint
CREATE UNIQUE INDEX "active_ticket_unique" ON "sale_items" USING btree ("ticket_number") WHERE "sale_items"."canceled_at" is null;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_vendor_idx" ON "sales" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "sales_participant_idx" ON "sales" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_name_unique" ON "vendors" USING btree (lower("name"));