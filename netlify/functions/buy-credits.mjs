/**
 * Creates a one-time Stripe Checkout Session for an analyzer credit pack,
 * served at POST /api/buy-credits.
 *
 * This is the "top up" half of the credit model: the subscription sells ongoing
 * access, this sells a fixed number of analyzer runs to someone who does not
 * want a recurring charge, or to a metered subscriber who has used their
 * monthly allowance.
 *
 * Packs are defined in db/credits.ts (CREDIT_CONFIG.packs). A pack is only
 * offered once its Stripe price id is present in the environment, so this
 * endpoint reports 503 with `packsUnavailable` until then and the front end
 * falls back to offering the subscription instead of showing a dead button.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY              live key (sk_live_...) on the published site
 *   STRIPE_CREDITS_5_PRICE_ID      one-time price for the 5-analysis pack
 *   STRIPE_CREDITS_15_PRICE_ID     one-time price for the 15-analysis pack
 *   STRIPE_CREDITS_40_PRICE_ID     one-time price for the 40-analysis pack
 *
 * Run `npm run setup:credit-packs` to create those prices in Stripe and print
 * the ids to paste into the Netlify UI.
 */
import Stripe from "stripe";
import { getUser } from "@netlify/identity";
import { ensureAppAccount } from "../../db/accounts.js";
import { availablePacks, findPack } from "../../db/credits.js";

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const isPublishedProduction = (context) => context.deploy?.published === true;

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
    if (!secretKey) {
      return json({ error: "Credit packs are not available yet.", packsUnavailable: true }, 503);
    }
    if (isPublishedProduction(context) && !secretKey.startsWith("sk_live_")) {
      console.error("A live Stripe secret key is required on the published site.");
      return json({ error: "Credit packs are unavailable.", packsUnavailable: true }, 503);
    }

    const packs = availablePacks();
    if (!packs.length) {
      console.error(
        "No credit pack price ids are configured; set STRIPE_CREDITS_*_PRICE_ID to sell packs.",
      );
      return json({ error: "Credit packs are not available yet.", packsUnavailable: true }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const pack = findPack(body.packId);
    if (!pack) {
      return json(
        { error: "Unknown credit pack", packs: packs.map(({ id, label, credits }) => ({ id, label, credits })) },
        400,
      );
    }

    const { account } = await ensureAppAccount({ id: user.id, email: user.email });
    const existingCustomerId = account?.stripeCustomerId || null;

    const origin = resolveOrigin(req);
    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: pack.priceId, quantity: 1 }],
      client_reference_id: user.id,
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: user.email }),
      success_url: `${origin}/?credits_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      allow_promotion_codes: true,
      // The webhook reads these to decide how many credits to grant, so they
      // must be on the session itself rather than inferred from the price.
      metadata: {
        identity_user_id: user.id,
        credit_pack_id: pack.id,
        credit_amount: String(pack.credits),
      },
      payment_intent_data: {
        metadata: {
          identity_user_id: user.id,
          credit_pack_id: pack.id,
          credit_amount: String(pack.credits),
        },
      },
    });

    if (!session.url) {
      console.error("Stripe returned a credit-pack session without a redirect URL.");
      return json({ error: "Could not start checkout." }, 502);
    }

    return json({ url: session.url, pack: { id: pack.id, credits: pack.credits } });
  } catch (error) {
    console.error("Credit pack checkout failed.", error);
    return json({ error: "Could not start checkout." }, 503);
  }
};

export const config = {
  path: "/api/buy-credits",
  method: "POST",
};
