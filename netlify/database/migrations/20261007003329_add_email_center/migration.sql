CREATE TABLE "email_contacts" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"first_name" text,
	"inner_circle" boolean DEFAULT false NOT NULL,
	"quiz_taker" boolean DEFAULT false NOT NULL,
	"last_quiz_name" text,
	"last_quiz_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" serial PRIMARY KEY,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_tokens" (
	"id" serial PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
