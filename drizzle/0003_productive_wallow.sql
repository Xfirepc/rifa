CREATE TABLE "google_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "single_google_connection" CHECK ("google_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "google_oauth_state" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"session_hash" text NOT NULL,
	"pin_proof" text NOT NULL,
	"verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_oauth_state" ADD CONSTRAINT "google_oauth_state_session_hash_sessions_token_hash_fk" FOREIGN KEY ("session_hash") REFERENCES "public"."sessions"("token_hash") ON DELETE cascade ON UPDATE no action;