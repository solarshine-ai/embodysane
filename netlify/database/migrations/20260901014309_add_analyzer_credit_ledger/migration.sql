CREATE TABLE "credit_purchases" (
	"id" serial PRIMARY KEY,
	"stripe_checkout_session_id" text NOT NULL UNIQUE,
	"identity_user_id" text,
	"customer_email" text,
	"stripe_customer_id" text,
	"pack_id" text,
	"credits" integer NOT NULL,
	"amount_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "analysis_credits" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "analyses_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "credits_renewed_at" timestamp with time zone;