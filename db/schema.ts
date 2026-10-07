import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type AccountData = {
  diary: unknown[];
  vault: unknown[];
  freeAnalyses: number;
  dailyAnalyses: { date: string; count: number };
};

export const stripeEntitlements = pgTable("stripe_entitlements", {
  id: serial().primaryKey(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  checkoutSessionId: text("checkout_session_id").unique(),
  customerEmail: text("customer_email"),
  status: text().notNull(),
  accessActive: boolean("access_active").notNull().default(false),
  lastStripeEventId: text("last_stripe_event_id"),
  lastStripeEventCreatedAt: timestamp("last_stripe_event_created_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const appAccounts = pgTable("app_accounts", {
  identityUserId: text("identity_user_id").primaryKey(),
  email: text().notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  founderAccess: boolean("founder_access").default(false).notNull(),
  dataInitialized: boolean("data_initialized").default(false).notNull(),
  // Server-authoritative analyzer credit balance. The browser copy in
  // localStorage was advisory only -- clearing site data reset it, and every
  // analysis bills the Anthropic API, so the real balance has to live here.
  analysisCredits: integer("analysis_credits").default(3).notNull(),
  // Lifetime analyses run by this account. Never reset; used for support and
  // for seeing real usage against API spend.
  analysesUsed: integer("analyses_used").default(0).notNull(),
  // When a metered subscriber's monthly allowance was last topped up. Stays
  // null while subscribers are unlimited.
  creditsRenewedAt: timestamp("credits_renewed_at", { withTimezone: true }),
  accountData: jsonb("account_data")
    .$type<AccountData>()
    .default({ diary: [], vault: [], freeAnalyses: 2, dailyAnalyses: { date: "", count: 0 } })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One row per completed credit-pack purchase.
 *
 * Exists for idempotency as much as for history: Stripe retries webhook
 * deliveries, and a retry must never grant a second batch of credits. The
 * UNIQUE checkout session id makes a duplicate grant impossible at the
 * database level rather than relying on application logic.
 */
export const creditPurchases = pgTable("credit_purchases", {
  id: serial().primaryKey(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
  identityUserId: text("identity_user_id"),
  customerEmail: text("customer_email"),
  stripeCustomerId: text("stripe_customer_id"),
  packId: text("pack_id"),
  credits: integer().notNull(),
  amountCents: integer("amount_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Everyone who handed over an email outside of creating an account: the Home
 * screen "inner circle" signup and the "email me my result" quiz form. One row
 * per address, so the owner sees a single list instead of one per form.
 */
export const emailContacts = pgTable("email_contacts", {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  firstName: text("first_name"),
  innerCircle: boolean("inner_circle").default(false).notNull(),
  quizTaker: boolean("quiz_taker").default(false).notNull(),
  lastQuizName: text("last_quiz_name"),
  lastQuizResult: text("last_quiz_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Every email the app attempts, with the outcome. Exists so a failed send is
 * visible on the admin page instead of disappearing into function logs.
 */
export const emailLog = pgTable("email_log", {
  id: serial().primaryKey(),
  kind: text().notNull(),
  toEmail: text("to_email").notNull(),
  subject: text().notNull(),
  status: text().notNull(),
  error: text(),
  providerMessageId: text("provider_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One-time sign-in links the app emails itself through Brevo. Only a SHA-256
 * hash of the token is stored, so a database read cannot be replayed as a
 * login.
 */
export const signInTokens = pgTable("sign_in_tokens", {
  id: serial().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text().notNull(),
  purpose: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
