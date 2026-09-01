import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { appAccounts, type AccountData } from "./schema.js";
import { findStripeEntitlementForAccount } from "./subscriptions.js";
import { CREDIT_CONFIG } from "../lib/credit-packs.mjs";

const TRIAL_DAYS = 3;

type IdentityAccount = {
  id: string;
  email: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function ensureAppAccount(user: IdentityAccount) {
  const email = normalizeEmail(user.email);
  let [account] = await db
    .select()
    .from(appAccounts)
    .where(eq(appAccounts.identityUserId, user.id))
    .limit(1);

  if (!account) {
    [account] = await db
      .insert(appAccounts)
      // Set the starting balance explicitly rather than leaning on the column
      // default, so lib/credit-packs.mjs is genuinely the one place that decides
      // it. The column default stays as a backstop for rows created elsewhere.
      .values({
        identityUserId: user.id,
        email,
        analysisCredits: CREDIT_CONFIG.signupCredits,
      })
      .onConflictDoNothing({ target: appAccounts.identityUserId })
      .returning();

    if (!account) {
      [account] = await db
        .select()
        .from(appAccounts)
        .where(eq(appAccounts.identityUserId, user.id))
        .limit(1);
    }
  } else if (account.email !== email) {
    [account] = await db
      .update(appAccounts)
      .set({ email, updatedAt: new Date() })
      .where(eq(appAccounts.identityUserId, user.id))
      .returning();
  }

  const entitlement = await findStripeEntitlementForAccount(
    account.stripeCustomerId,
    email,
  );

  if (
    entitlement?.stripeCustomerId &&
    entitlement.stripeCustomerId !== account.stripeCustomerId
  ) {
    [account] = await db
      .update(appAccounts)
      .set({
        stripeCustomerId: entitlement.stripeCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(appAccounts.identityUserId, user.id))
      .returning();
  }

  return { account, entitlement };
}

export async function saveAccountData(
  identityUserId: string,
  accountData: AccountData,
  trialStartedAt?: Date,
) {
  const [account] = await db
    .update(appAccounts)
    .set({
      accountData,
      dataInitialized: true,
      ...(trialStartedAt ? { trialStartedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(appAccounts.identityUserId, identityUserId))
    .returning();

  return account;
}

export async function clearAccountData(identityUserId: string) {
  const [account] = await db
    .update(appAccounts)
    .set({
      accountData: {
        diary: [],
        vault: [],
        freeAnalyses: 2,
        dailyAnalyses: { date: "", count: 0 },
      },
      dataInitialized: true,
      updatedAt: new Date(),
    })
    .where(eq(appAccounts.identityUserId, identityUserId))
    .returning();

  return account;
}

export async function grantFounderAccess(identityUserId: string) {
  const [account] = await db
    .update(appAccounts)
    .set({ founderAccess: true, updatedAt: new Date() })
    .where(eq(appAccounts.identityUserId, identityUserId))
    .returning();

  return account;
}

export async function linkAccountToStripe(
  identityUserId: string,
  stripeCustomerId: string,
) {
  const [account] = await db
    .update(appAccounts)
    .set({ stripeCustomerId, updatedAt: new Date() })
    .where(eq(appAccounts.identityUserId, identityUserId))
    .returning();

  return account;
}

export async function linkAccountToStripeByEmail(
  email: string,
  stripeCustomerId: string,
) {
  const [account] = await db
    .update(appAccounts)
    .set({ stripeCustomerId, updatedAt: new Date() })
    .where(eq(appAccounts.email, normalizeEmail(email)))
    .returning();

  return account ?? null;
}

export function accountAccess(account: typeof appAccounts.$inferSelect, entitlement: Awaited<ReturnType<typeof findStripeEntitlementForAccount>>) {
  const trialEndsAt = new Date(
    account.trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );
  const trialActive = trialEndsAt.getTime() > Date.now();
  const subscriptionActive = entitlement?.accessActive === true;

  return {
    active: account.founderAccess || subscriptionActive || trialActive,
    founderAccess: account.founderAccess,
    subscriptionActive,
    subscriptionStatus: entitlement?.status ?? null,
    trialActive,
    trialStartedAt: account.trialStartedAt.toISOString(),
    trialEndsAt: trialEndsAt.toISOString(),
  };
}
