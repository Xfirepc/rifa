CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_sync" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"synced_revision" bigint DEFAULT 0 NOT NULL,
	"spreadsheet_id" text,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"syncing" boolean DEFAULT false NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "single_sheet_sync" CHECK ("sheet_sync"."id" = 1),
	CONSTRAINT "sync_revision_order" CHECK ("sheet_sync"."synced_revision" <= "sheet_sync"."revision")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "credential_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_expiry_idx" ON "login_attempts" USING btree ("expires_at");
--> statement-breakpoint
DELETE FROM sessions;
--> statement-breakpoint
INSERT INTO sheet_sync (id) VALUES (1);
--> statement-breakpoint
CREATE FUNCTION mark_sheet_sync_pending() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sheet_sync SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON sales FOR EACH STATEMENT EXECUTE FUNCTION mark_sheet_sync_pending();
--> statement-breakpoint
CREATE TRIGGER items_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON sale_items FOR EACH STATEMENT EXECUTE FUNCTION mark_sheet_sync_pending();
--> statement-breakpoint
CREATE TRIGGER participants_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON participants FOR EACH STATEMENT EXECUTE FUNCTION mark_sheet_sync_pending();
--> statement-breakpoint
CREATE TRIGGER vendors_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON vendors FOR EACH STATEMENT EXECUTE FUNCTION mark_sheet_sync_pending();
