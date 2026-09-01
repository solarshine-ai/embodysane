/**
 * Creates a Stripe Checkout Session, served at POST /api/create-checkout.
 *
 * Replaces the hardcoded Stripe Payment Link. The Payment Link did already
 * forward client_reference_id as a URL parameter, so account linking worked;
 * what it could not do is:
 *
 *   1. Reuse the Stripe customer already linked to the account. A Payment Link
 *      with prefilled_email mints a fresh customer on every checkout, so a
 *      resubscribing user acquires a second customer id -- and
 *      stripe_customer_id is UNIQUE in both app_accounts and
 *      stripe_entitlements, so the duplicate collides or mislinks.
 *   2. Vary the post-payment redirect by environment. A Payment Link's redirect
 *      is fixed in the Stripe Dashboard, so a checkout started from a Preview
 *      Server sent the customer back to production, where the ?session_id was
 *      verified against the wrong origin.
 *
 * Setting client_reference_id server-side is also tamper-proof, where a URL
 * parameter can be edited by the payer before submitting.
 *
 * Required env vars (names are case-sensitive):
 *   STRIPE_SECRET_KEY   live key (sk_live_...) once the site is published
 *   STRIPE_PRICE_ID     recurring price to subscribe the customer to (price_...)
 *
 * Without STRIPE_PRICE_ID this returns 503 with checkoutUnavailable, and the
 * front end falls back to the Payment Link so checkout never goes dark.
 */
import Stripe from "stripe";
import { getUser } from "@netlify/identity";
import { ensureAppAccount } from "../../db/accounts.js";

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const isPublishedProduction = (context) => context.deploy?.published === true;

// Prefer the origin the request actually arrived on so Deploy Previews and
// Preview Servers return the customer to themselves rather than production.
const resolveOrigin = (req) => {
  try {
    return new URL(req.url).origin;
  } catch {
    return Netlify.env.get("URL") || "https://embodysane.com";
  }
};

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user?.id || !user.email) {
      return json({ error: "Sign in required" }, 401);
    }

    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    const priceId = Netlify.env.get("STRIPE_PRICE_ID");

    if (!secretKey) {
      return json({ error: "Checkout is not configured yet.", checkoutUnavailable: true }, 503);
    }
    if (!priceId) {
      console.error("STRIPE_PRICE_ID is not set; cannot create a Checkout Session.");
      return json({ error: "Checkout is not configured yet.", checkoutUnavailable: true }, 503);
    }
    if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
      console.error("A live Stripe secret key is required on the published site.");
      return json({ error: "Checkout is unavailable.", checkoutUnavailable: true }, 503);
    }

    // Reuse the Stripe customer already linked to this account so renewals and
    // upgrades stay on one customer record instead of fragmenting per checkout.
    const { account } = await ensureAppAccount({ id: user.id, email: user.email });
    const existingCustomerId = account?.stripeCustomerId || null;

    const origin = resolveOrigin(req);
    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // The whole point of this endpoint: ties the session to the Identity user.
      client_reference_id: user.id,
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: user.email }),
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { identity_user_id: user.id },
      },
      metadata: { identity_user_id: user.id },
    });

    if (!session.url) {
      console.error("Stripe returned a session without a redirect URL.");
      return json({ error: "Could not start checkout." }, 502);
    }

    return json({ url: session.url });
  } catch (error) {
    console.error("Checkout session creation failed.", error);
    return json({ error: "Could not start checkout." }, 503);
  }
};

export const config = {
  path: "/api/create-checkout",
  method: "POST",
};
