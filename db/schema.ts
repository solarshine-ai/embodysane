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
