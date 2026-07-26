CREATE TABLE "app_accounts" (
	"identity_user_id" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"stripe_customer_id" text UNIQUE,
	"trial_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"founder_access" boolean DEFAULT false NOT NULL,
	"data_initialized" boolean DEFAULT false NOT NULL,
	"account_data" jsonb DEFAULT '{"diary":[],"vault":[],"freeAnalyses":2,"dailyAnalyses":{"date":"","count":0}}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
