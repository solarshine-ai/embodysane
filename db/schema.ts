import {
  boolean,
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
  accountData: jsonb("account_data")
    .$type<AccountData>()
    .default({ diary: [], vault: [], freeAnalyses: 2, dailyAnalyses: { date: "", count: 0 } })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
