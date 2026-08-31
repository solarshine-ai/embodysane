/**
 * Stripe webhook receiver, served at POST /api/stripe-webhooks.
 *
 * Keeps stripe_entitlements in step with Stripe and links each entitlement to
 * the Identity account that owns it, so renewals, cancellations and failed
 * payments change access without the customer returning to the site.
 *
 * Required env vars (names are case-sensitive):
 *   STRIPE_SECRET_KEY       live key (sk_live_...) once the site is published
 *   STRIPE_WEBHOOK_SECRET   signing secret (whsec_...) for this endpoint
 *
 * Without both, the endpoint returns 503 and processes nothing.
 */
import Stripe from "stripe";
import {
  linkAccountToStripe,
  linkAccountToStripeByEmail,
} from "../../db/accounts.js";
import { saveStripeEntitlement } from "../../db/subscriptions.js";

const jsonResponse = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const stripeId = (value) =>
  typeof value === "string" ? value : value?.id ?? null;

const invoiceSubscriptionId = (invoice) =>
  stripeId(invoice.subscription) ||
  stripeId(invoice.parent?.subscription_details?.subscription);

const isPublishedProduction = (context) => context.deploy?.published === true;

export default async (req, context) => {
  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");

  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook environment variables are not configured.");
    return jsonResponse({ received: false }, 503);
  }

  if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
    console.error("A live Stripe secret key is required on the published site.");
    return jsonResponse({ received: false }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ received: false }, 400);
  }

  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      await req.text(),
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed.", error);
    return jsonResponse({ received: false }, 400);
  }

  if (isPublishedProduction(context) && stripeEvent.livemode !== true) {
    console.error("A test-mode Stripe event reached the published webhook.");
    return jsonResponse({ received: false }, 400);
  }

  const eventMetadata = {
    lastStripeEventId: stripeEvent.id,
    lastStripeEventCreatedAt: new Date(stripeEvent.created * 1000),
  };

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed": {
        const session = stripeEvent.data.object;
        if (session.mode !== "subscription") break;

        const accessActive =
          stripeEvent.type !== "checkout.session.async_payment_failed" &&
          session.status === "complete" &&
          (session.payment_status === "paid" ||
            session.payment_status === "no_payment_required");

        const entitlement = await saveStripeEntitlement({
          stripeCustomerId: stripeId(session.customer),
          stripeSubscriptionId: stripeId(session.subscription),
          checkoutSessionId: session.id,
          customerEmail:
            session.customer_details?.email || session.customer_email || null,
          status: accessActive ? "active" : "payment_failed",
          accessActive,
          ...eventMetadata,
        });
        if (entitlement.stripeCustomerId) {
          if (session.client_reference_id) {
            await linkAccountToStripe(
              session.client_reference_id,
              entitlement.stripeCustomerId,
            );
          } else if (entitlement.customerEmail) {
            await linkAccountToStripeByEmail(
              entitlement.customerEmail,
              entitlement.stripeCustomerId,
            );
          }
        }
        break;
      }

      case "invoice.paid": {
        const invoice = stripeEvent.data.object;

        const entitlement = await saveStripeEntitlement({
          stripeCustomerId: stripeId(invoice.customer),
          stripeSubscriptionId: invoiceSubscriptionId(invoice),
          customerEmail: invoice.customer_email || null,
          status: "active",
          accessActive: true,
          ...eventMetadata,
        });
        if (entitlement.stripeCustomerId && entitlement.customerEmail) {
          await linkAccountToStripeByEmail(
            entitlement.customerEmail,
            entitlement.stripeCustomerId,
          );
        }
        break;
      }

      case "invoice.payment_action_required":
      case "invoice.payment_failed": {
        const invoice = stripeEvent.data.object;

        await saveStripeEntitlement({
          stripeCustomerId: stripeId(invoice.customer),
          stripeSubscriptionId: invoiceSubscriptionId(invoice),
          customerEmail: invoice.customer_email || null,
          status:
            stripeEvent.type === "invoice.payment_action_required"
              ? "incomplete"
              : "past_due",
          accessActive: false,
          ...eventMetadata,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = stripeEvent.data.object;
        const accessActive =
          stripeEvent.type !== "customer.subscription.deleted" &&
          ["active", "trialing"].includes(subscription.status);

        await saveStripeEntitlement({
          stripeCustomerId: stripeId(subscription.customer),
          stripeSubscriptionId: subscription.id,
          status:
            stripeEvent.type === "customer.subscription.deleted"
              ? "canceled"
              : subscription.status,
          accessActive,
          ...eventMetadata,
        });
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${stripeEvent.type}`);
    }
  } catch (error) {
    console.error(`Stripe event processing failed for ${stripeEvent.id}.`, error);
    return jsonResponse({ received: false }, 500);
  }

  return jsonResponse({ received: true });
};

export const config = {
  path: "/api/stripe-webhooks",
  method: "POST",
};
