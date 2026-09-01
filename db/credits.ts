/**
 * Analyzer credit enforcement.
 *
 * Every Conversation Analyzer run costs real money on the Anthropic API, so the
 * number of runs an account may make has to be counted somewhere the customer
 * cannot edit. Before this, the count lived only in localStorage
 * (`es_free_analyses`, `es_daily_analyses`), which meant clearing site data
 * handed out a fresh allowance and the server happily served every request.
 * The balance here is the real one.
 *
 * The tunable numbers live in lib/credit-packs.mjs, shared with the setup and
 * verification scripts so there is only one place to change them.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./index.js";
import { appAccounts, creditPurchases } from "./schema.js";
import { CREDIT_CONFIG } from "../lib/credit-packs.mjs";

export { CREDIT_CONFIG };

export type CreditPack = {
  id: string;
  label: string;
  credits: number;
  priceEnv: string;
};

type Account = typeof appAccounts.$inferSelect;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** True when this account should never be metered. */
export function hasUnlimitedAnalyses(
  account: Account,
  subscriptionActive: boolean,
) {
  if (account.founderAccess) return true;
  return subscriptionActive && CREDIT_CONFIG.subscriberMonthlyCredits === null;
}

/** Packs that are actually purchasable right now (price id configured). */
export function availablePacks(): (CreditPack & { priceId: string })[] {
  return (CREDIT_CONFIG.packs as CreditPack[])
    .map((pack) => ({ ...pack, priceId: process.env[pack.priceEnv] || "" }))
    .filter((pack) => Boolean(pack.priceId));
}

export function findPack(packId: string) {
  return availablePacks().find((pack) => pack.id === packId) ?? null;
}

/**
 * Tops a metered subscriber back up to their monthly allowance.
 *
 * Uses GREATEST so credits bought on top of the allowance are not destroyed by
 * a renewal. No-op while subscribers are unlimited.
 */
export async function refreshSubscriberAllowance(
  account: Account,
  subscriptionActive: boolean,
) {
  const allowance = CREDIT_CONFIG.subscriberMonthlyCredits;
  if (allowance === null || !subscriptionActive) return account;

  const renewedAt = account.creditsRenewedAt?.getTime() ?? 0;
  if (Date.now() - renewedAt < MONTH_MS) return account;

  const [updated] = await db
    .update(appAccounts)
    .set({
      analysisCredits: sql`greatest(${appAccounts.analysisCredits}, ${allowance})`,
      creditsRenewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(appAccounts.identityUserId, account.identityUserId))
    .returning();

  return updated ?? account;
}

/**
 * Spends one credit, atomically.
 *
 * The balance check and the decrement are a single conditional UPDATE, so two
 * concurrent analyses cannot both pass a "do they have credit?" check and take
 * the balance negative. Returns null when the account cannot afford the run.
 */
export async function consumeAnalysisCredit(
  account: Account,
  subscriptionActive: boolean,
) {
  if (hasUnlimitedAnalyses(account, subscriptionActive)) {
    // Still worth counting: this is the only record of what the analyzer costs.
    const [updated] = await db
      .update(appAccounts)
      .set({
        analysesUsed: sql`${appAccounts.analysesUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(appAccounts.identityUserId, account.identityUserId))
      .returning();

    return updated ?? account;
  }

  const cost = CREDIT_CONFIG.costPerAnalysis;
  const [updated] = await db
    .update(appAccounts)
    .set({
      analysisCredits: sql`${appAccounts.analysisCredits} - ${cost}`,
      analysesUsed: sql`${appAccounts.analysesUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appAccounts.identityUserId, account.identityUserId),
        gt(appAccounts.analysisCredits, cost - 1),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Returns a credit that was taken for an analysis that then failed.
 *
 * Charging someone for a run that errored before producing anything is the
 * kind of thing that generates refund requests, so failures hand the credit
 * back rather than swallowing it.
 */
export async function refundAnalysisCredit(identityUserId: string) {
  const [updated] = await db
    .update(appAccounts)
    .set({
      analysisCredits: sql`${appAccounts.analysisCredits} + ${CREDIT_CONFIG.costPerAnalysis}`,
      analysesUsed: sql`greatest(${appAccounts.analysesUsed} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(appAccounts.identityUserId, identityUserId))
    .returning();

  return updated ?? null;
}

type PurchaseRecord = {
  stripeCheckoutSessionId: string;
  identityUserId?: string | null;
  customerEmail?: string | null;
  stripeCustomerId?: string | null;
  packId?: string | null;
  credits: number;
  amountCents?: number | null;
};

/**
 * Credits a completed pack purchase exactly once.
 *
 * Stripe retries webhook deliveries, and `checkout.session.completed` can also
 * arrive alongside the browser returning to the site, so this can be called
 * more than once for the same payment. The insert conflicts on the UNIQUE
 * checkout session id, and only an insert that actually created a row goes on
 * to move the balance. Returns null when the purchase was already applied.
 */
export async function applyCreditPurchase(purchase: PurchaseRecord) {
  const [recorded] = await db
    .insert(creditPurchases)
    .values({
      stripeCheckoutSessionId: purchase.stripeCheckoutSessionId,
      identityUserId: purchase.identityUserId ?? null,
      customerEmail: purchase.customerEmail ?? null,
      stripeCustomerId: purchase.stripeCustomerId ?? null,
      packId: purchase.packId ?? null,
      credits: purchase.credits,
      amountCents: purchase.amountCents ?? null,
    })
    .onConflictDoNothing({ target: creditPurchases.stripeCheckoutSessionId })
    .returning();

  if (!recorded) return null;

  // Prefer the Identity id; fall back to email for a purchase made through the
  // Payment Link path, where no client_reference_id comes back.
  const where = purchase.identityUserId
    ? eq(appAccounts.identityUserId, purchase.identityUserId)
    : purchase.customerEmail
      ? eq(appAccounts.email, purchase.customerEmail.trim().toLowerCase())
      : null;

  if (!where) return recorded;

  await db
    .update(appAccounts)
    .set({
      analysisCredits: sql`${appAccounts.analysisCredits} + ${purchase.credits}`,
      updatedAt: new Date(),
    })
    .where(where);

  return recorded;
}

/** Credit summary for API responses and the analyzer badge. */
export function creditState(account: Account, subscriptionActive: boolean) {
  const unlimited = hasUnlimitedAnalyses(account, subscriptionActive);

  return {
    unlimited,
    credits: unlimited ? null : account.analysisCredits,
    analysesUsed: account.analysesUsed,
    costPerAnalysis: CREDIT_CONFIG.costPerAnalysis,
    canAnalyze: unlimited || account.analysisCredits >= CREDIT_CONFIG.costPerAnalysis,
    packs: availablePacks().map(({ id, label, credits }) => ({ id, label, credits })),
  };
}
