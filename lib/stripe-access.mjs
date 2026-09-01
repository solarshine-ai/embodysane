/**
 * On-demand reconciliation of Stripe subscription state into stripe_entitlements.
 *
 * Access on this site is granted by a stripe_entitlements row with
 * access_active = true. Two things were supposed to write that row:
 *
 *   1. POST /api/stripe-webhooks, on checkout/invoice/subscription events.
 *   2. POST /api/verify-subscription, when Checkout redirects the customer back
 *      to the site with ?session_id=...
 *
 * Both are single points of failure, and both can miss silently:
 *
 *   - A webhook endpoint pointed at the wrong path still returns 200 from the
 *     static site, so Stripe records a successful delivery while the function
 *     never runs. Nothing in the product reports this.
 *   - A Payment Link configured with hosted_confirmation keeps the customer on
 *     Stripe's page after paying, so there is no redirect back and no
 *     ?session_id for verify-subscription to check.
 *
 * When both miss, the customer is charged every month and never gets access,
 * which is the worst failure this site can have. This module removes the
 * dependency on either path: whenever an account is loaded without active
 * access, ask Stripe directly whether that customer has a live subscription and
 * write the entitlement if so. Stripe is the source of truth for money, so
 * asking it is always safe, and it makes payment -> access self-healing.
 *
 * The lookup only runs for accounts that do NOT already have access, so an
 * active subscriber costs no extra Stripe calls after the first reconcile.
 */
import Stripe from "stripe";
import { linkAccountToStripe } from "../db/accounts.js";
import { saveStripeEntitlement } from "../db/subscriptions.js";

const ACTIVE_STATUSES = ["active", "trialing"];

// Statuses worth recording even though they do not grant access, so the account
// screen can explain *why* access is off instead of showing nothing.
const RECORDABLE_STATUSES = [
  ...ACTIVE_STATUSES,
  "past_due",
  "incomplete",
  "unpaid",
  "canceled",
];

const isPublishedProduction = (context) => context?.deploy?.published === true;

const stripeClient = (secretKey) =>
  new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });

/** Candidate Stripe customers for this account: the linked id first, then email. */
const findCustomerIds = async (stripe, { stripeCustomerId, email }) => {
  const ids = [];

  if (stripeCustomerId) {
    ids.push(stripeCustomerId);
  }

  if (email) {
    // A Payment Link with prefilled_email mints a fresh customer per checkout,
    // so the same person can own several customer records. Check them all.
    const { data } = await stripe.customers.list({ email, limit: 10 });
    for (const customer of data) {
      if (!ids.includes(customer.id)) ids.push(customer.id);
    }
  }

  return ids;
};

/** The most relevant subscription across every customer record for this person. */
const findSubscription = async (stripe, customerIds) => {
  let fallback = null;

  for (const customer of customerIds) {
    const { data } = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 20,
    });

    for (const subscription of data) {
      if (ACTIVE_STATUSES.includes(subscription.status)) {
        return subscription;
      }
      if (!fallback && RECORDABLE_STATUSES.includes(subscription.status)) {
        fallback = subscription;
      }
    }
  }

  return fallback;
};

/**
 * Grants access when Stripe says this customer is paying and the database has
 * not caught up. Returns the entitlement to use, or the one passed in when
 * there is nothing to change. Never throws: a Stripe outage must not take down
 * the account endpoint, it just leaves access as the database already had it.
 */
export async function reconcileStripeAccess({
  account,
  entitlement,
  identityUserId,
  email,
  context,
}) {
  // Already paying, or access comes from elsewhere: nothing to look up.
  if (entitlement?.accessActive === true) return entitlement;
  if (account?.founderAccess === true) return entitlement;

  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) return entitlement;

  // Mirrors the other Stripe functions: never resolve live access from a test key.
  if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
    return entitlement;
  }

  try {
    const stripe = stripeClient(secretKey);
    const customerIds = await findCustomerIds(stripe, {
      stripeCustomerId: account?.stripeCustomerId ?? null,
      email,
    });
    if (!customerIds.length) return entitlement;

    const subscription = await findSubscription(stripe, customerIds);
    if (!subscription) return entitlement;

    const accessActive = ACTIVE_STATUSES.includes(subscription.status);

    // Nothing new to record: Stripe agrees access should be off and the
    // database already says so.
    if (!accessActive && entitlement && entitlement.status === subscription.status) {
      return entitlement;
    }

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id ?? null;

    // saveStripeEntitlement only applies a status when the incoming event is at
    // least as new as the stored one, and short-circuits when the event id is
    // unchanged. This is a live read rather than a replayed event, so stamp it
    // as "now" with a unique marker to make it authoritative without ever
    // colliding with a real Stripe event id.
    const reconciledAt = new Date();
    const saved = await saveStripeEntitlement({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      customerEmail: email,
      status: subscription.status,
      accessActive,
      lastStripeEventId: `reconcile_${subscription.id}_${reconciledAt.getTime()}`,
      lastStripeEventCreatedAt: reconciledAt,
    });

    // Keep the account pointed at the customer we just resolved so later reads
    // hit the fast path. stripe_customer_id is UNIQUE, so a customer already
    // claimed by another account must not break this request.
    if (customerId && identityUserId && account?.stripeCustomerId !== customerId) {
      try {
        await linkAccountToStripe(identityUserId, customerId);
      } catch (error) {
        console.error(
          `Could not link account ${identityUserId} to Stripe customer ${customerId}.`,
          error,
        );
      }
    }

    if (accessActive) {
      console.log(
        `Reconciled Stripe access for ${customerId} (${subscription.status}) ` +
          `from a live Stripe read; webhook delivery had not recorded it.`,
      );
    }

    return saved ?? entitlement;
  } catch (error) {
    console.error("Stripe access reconciliation failed.", error);
    return entitlement;
  }
}
