/**
 * Confirms a credit-pack purchase on return from Stripe, served at
 * POST /api/verify-credits.
 *
 * The webhook already grants credits, so this is deliberately a second path to
 * the same outcome rather than the only one. It exists because the customer is
 * standing in front of the screen expecting their credits: waiting on webhook
 * delivery would show them a stale balance, and the site has already been
 * burned once by trusting a single Stripe notification path.
 *
 * Granting is idempotent at the database level (UNIQUE checkout session id), so
 * whichever of the two arrives first wins and the other is a no-op.
 */
import Stripe from "stripe";
import { getUser } from "@netlify/identity";
import { accountAccess, ensureAppAccount } from "../../db/accounts.js";
import { applyCreditPurchase, creditState } from "../../db/credits.js";

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const isPublishedProduction = (context) => context.deploy?.published === true;

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user?.id || !user.email) {
      return json({ error: "Sign in required" }, 401);
    }

    const { credits_session_id: sessionId } = await req.json().catch(() => ({}));
    if (!sessionId || typeof sessionId !== "string") {
      return json({ error: "Missing session id" }, 400);
    }

    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) {
      return json({ error: "Payment verification is not configured yet." }, 503);
    }
    if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
      console.error("A live Stripe secret key is required on the published site.");
      return json({ error: "Payment verification is unavailable." }, 503);
    }

    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const sessionEmail =
      session.customer_details?.email || session.customer_email || "";
    const belongsToUser =
      session.client_reference_id === user.id ||
      session.metadata?.identity_user_id === user.id ||
      sessionEmail.trim().toLowerCase() === user.email.toLowerCase();

    const paid =
      session.mode === "payment" &&
      session.status === "complete" &&
      (session.payment_status === "paid" ||
        session.payment_status === "no_payment_required");

    if (
      !paid ||
      !belongsToUser ||
      (isPublishedProduction(context) && session.livemode !== true)
    ) {
      return json({ granted: false, error: "This purchase could not be confirmed" }, 400);
    }

    const credits = Number(session.metadata?.credit_amount);
    if (!Number.isFinite(credits) || credits <= 0) {
      console.error(`Credit-pack session ${session.id} has no usable credit_amount.`);
      return json({ granted: false, error: "This purchase could not be confirmed" }, 400);
    }

    const applied = await applyCreditPurchase({
      stripeCheckoutSessionId: session.id,
      identityUserId: user.id,
      customerEmail: sessionEmail || user.email,
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      packId: session.metadata?.credit_pack_id || null,
      credits,
      amountCents: session.amount_total ?? null,
    });

    // Re-read the account so the response carries the balance after the grant,
    // whether this request applied it or the webhook got there first.
    const { account, entitlement } = await ensureAppAccount({
      id: user.id,
      email: user.email,
    });
    const access = accountAccess(account, entitlement);

    return json({
      granted: true,
      newlyApplied: Boolean(applied),
      credits: creditState(account, access.subscriptionActive),
    });
  } catch (error) {
    console.error("Credit purchase verification failed.", error);
    return json({ error: "Verification failed" }, 503);
  }
};

export const config = {
  path: "/api/verify-credits",
  method: "POST",
};
