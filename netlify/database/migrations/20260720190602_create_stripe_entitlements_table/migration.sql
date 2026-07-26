CREATE TABLE "stripe_entitlements" (
	"id" serial PRIMARY KEY,
	"stripe_customer_id" text UNIQUE,
	"stripe_subscription_id" text UNIQUE,
	"checkout_session_id" text UNIQUE,
	"customer_email" text,
	"status" text NOT NULL,
	"access_active" boolean DEFAULT false NOT NULL,
	"last_stripe_event_id" text,
	"last_stripe_event_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
