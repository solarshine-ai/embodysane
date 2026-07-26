import Stripe from "stripe";
import { getUser } from "@netlify/identity";
import {
  ensureAppAccount,
  linkAccountToStripe,
} from "../../db/accounts.js";
import {
  findStripeEntitlementBySessionId,
  saveStripeEntitlement,
} from "../../db/subscriptions.js";

const responseOptions = (status = 200) => ({
  status,
  headers: { "Cache-Control": "no-store" },
});

const isPublishedProduction = (context) => context.deploy?.published === true;

export default async (req, context) => {
  if (req.method !== "POST") {
    return Response.json(
      { valid: false, error: "Method not allowed" },
      responseOptions(405),
    );
  }

  try {
    const user = await getUser();
    if (!user?.id || !user.email) {
      return Response.json(
        { valid: false, error: "Sign in required" },
        responseOptions(401),
      );
    }

    await ensureAppAccount({ id: user.id, email: user.email });
    const { session_id } = await req.json();
    if (!session_id || typeof session_id !== "string") {
      return Response.json(
        { valid: false, error: "Missing session id" },
        responseOptions(400),
      );
    }

    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) {
      return Response.json(
        { valid: false, error: "Payment verification is not configured yet." },
        responseOptions(503),
      );
    }

    if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
      console.error("A live Stripe secret key is required on the published site.");
      return Response.json(
        { valid: false, error: "Payment verification is unavailable." },
        responseOptions(503),
      );
    }

    const existing = await findStripeEntitlementBySessionId(session_id);
    if (existing) {
      const emailMatches =
        existing.customerEmail?.trim().toLowerCase() === user.email.toLowerCase();
      if (!emailMatches || !existing.stripeCustomerId) {
        return Response.json(
          { valid: false, error: "This checkout belongs to another account" },
          responseOptions(403),
        );
      }
      await linkAccountToStripe(user.id, existing.stripeCustomerId);
      return Response.json(
        {
          valid: existing.accessActive,
          status: existing.status,
        },
        responseOptions(),
      );
    }

    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const sessionEmail =
      session.customer_details?.email || session.customer_email || "";
    const belongsToUser =
      session.client_reference_id === user.id ||
      sessionEmail.trim().toLowerCase() === user.email.toLowerCase();

    if (
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      (isPublishedProduction(context) && session.livemode !== true) ||
      !belongsToUser
    ) {
      return Response.json(
        { valid: false, status: "invalid" },
        responseOptions(400),
      );
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    const subscription = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null;
    const accessActive =
      Boolean(subscription) && ["active", "trialing"].includes(subscription.status);

    const entitlement = await saveStripeEntitlement({
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : session.customer?.id,
      stripeSubscriptionId: subscriptionId,
      checkoutSessionId: session.id,
      customerEmail:
        session.customer_details?.email || session.customer_email || null,
      status: subscription?.status || "incomplete",
      accessActive,
    });

    if (entitlement.stripeCustomerId) {
      await linkAccountToStripe(user.id, entitlement.stripeCustomerId);
    }

    return Response.json(
      {
        valid: entitlement.accessActive,
        status: entitlement.status,
      },
      responseOptions(),
    );
  } catch (error) {
    console.error("Subscription verification failed.", error);
    return Response.json(
      { valid: false, error: "Verification failed" },
      responseOptions(503),
    );
  }
};

export const config = {
  path: "/api/verify-subscription",
  method: "POST",
};
