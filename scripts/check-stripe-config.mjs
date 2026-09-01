/**
 * Verifies that what the site advertises matches what Stripe will actually
 * charge, and that Stripe can actually tell the site about a payment.
 *
 * The failure this exists to catch is silent by design. A webhook endpoint
 * pointed at the site root returns 200 from index.html, so Stripe's dashboard
 * shows healthy deliveries while the function never runs and no customer ever
 * gets access. Nothing in the product surfaces that. This script does.
 *
 * Run it any time with:  npm run verify:stripe
 *
 * Needs STRIPE_SECRET_KEY in the environment. Reads only -- it changes nothing,
 * and it never prints key material.
 */
import { readFile } from "node:fs/promises";
import { CREDIT_CONFIG } from "../lib/credit-packs.mjs";

const SITE = process.env.URL || "https://embodysane.com";
const WEBHOOK_PATH = "/api/stripe-webhooks";

// The events netlify/functions/stripe-webhooks.mjs acts on. Anything missing
// from the endpoint means that transition never reaches the database.
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const results = [];
const pass = (label, detail = "") => results.push({ ok: true, label, detail });
const fail = (label, detail = "") => results.push({ ok: false, label, detail });
const warn = (label, detail = "") =>
  results.push({ ok: true, warn: true, label, detail });

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set; cannot verify Stripe config.");
  process.exit(2);
}

const stripe = async (path) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await response.json();
  if (body.error) throw new Error(`Stripe ${path}: ${body.error.message}`);
  return body;
};

const money = (cents, currency) =>
  `${(cents / 100).toFixed(2)} ${String(currency).toUpperCase()}`;

// ── What the site advertises ────────────────────────────────────────────────
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

const advertised = html.match(/\$([0-9]+(?:\.[0-9]{2})?)\s*<span[^>]*>\s*\/\s*month/i);
const advertisedCents = advertised
  ? Math.round(parseFloat(advertised[1]) * 100)
  : null;

const linkMatch = html.match(/window\.STRIPE_LINK\s*=\s*"([^"]+)"/);
const advertisedLink = linkMatch ? linkMatch[1] : null;

if (advertisedCents === null) {
  warn("Advertised price", "could not find a '$X.XX / month' price in index.html");
} else {
  pass("Advertised price", `index.html shows ${money(advertisedCents, "usd")} / month`);
}

// ── Account can take money ─────────────────────────────────────────────────
const account = await stripe("account");
if (!key.startsWith("sk_live_")) {
  fail("Stripe key mode", "STRIPE_SECRET_KEY is a test key; live payments will not work");
} else {
  pass("Stripe key mode", "live key");
}
if (account.charges_enabled) pass("Charges enabled", account.business_profile?.name || account.id);
else fail("Charges enabled", "Stripe will refuse payments until onboarding is complete");
if (account.payouts_enabled) pass("Payouts enabled", "money can reach your bank");
else fail("Payouts enabled", "you can be paid but cannot withdraw yet");

// ── The price the code will charge ─────────────────────────────────────────
const priceId = process.env.STRIPE_PRICE_ID;
if (!priceId) {
  fail(
    "STRIPE_PRICE_ID",
    "not set, so /api/create-checkout returns 503 and checkout silently falls back to the Payment Link",
  );
}

// A price id that does not resolve has exactly the same effect as an unset one:
// create-checkout throws, and the customer silently lands on the fallback
// Payment Link. That has to be reported rather than crash the whole check, so
// the lookup is resolved up front and the assertions below only run on a real
// price.
let price = null;
if (priceId) {
  try {
    price = await stripe(`prices/${priceId}?expand[]=product`);
  } catch {
    // create-checkout restores a missing `price_` prefix rather than losing the
    // sale, so mirror that here: if the prefixed form resolves, checkout does
    // work and the finding is a warning, not a dead checkout. The variable is
    // still wrong and still worth reporting.
    const prefixed = `price_${priceId}`;
    if (!priceId.startsWith("price_")) {
      try {
        price = await stripe(`prices/${prefixed}?expand[]=product`);
        warn(
          "STRIPE_PRICE_ID",
          `set to "${priceId}", which is missing the "price_" prefix. ` +
            `/api/create-checkout compensates and uses ${prefixed}, so checkout works, ` +
            `but set the variable to ${prefixed} to remove the workaround.`,
        );
      } catch { /* fall through to the failure below */ }
    }

    if (!price) {
      fail(
        "STRIPE_PRICE_ID",
        `set to "${priceId}", which does not exist in this Stripe account. ` +
          'Stripe price ids look like "price_1Abc...". Until it resolves, ' +
          "/api/create-checkout fails and checkout falls back to the Payment Link, " +
          "losing client_reference_id -- the customer pays and gets nothing.",
      );
    }
  }
}

if (price) {
  const bits = [`${money(price.unit_amount, price.currency)}`];
  bits.push(price.recurring ? `every ${price.recurring.interval_count} ${price.recurring.interval}` : "ONE-TIME");
  if (price.id === priceId) {
    pass("STRIPE_PRICE_ID", `${priceId} — ${bits.join(", ")} — ${price.product?.name ?? ""}`);
  }

  if (!price.active) fail("Checkout price active", `${priceId} is archived in Stripe`);
  else pass("Checkout price active", "yes");

  if (!price.recurring) {
    fail("Checkout price is a subscription", "the site sells a monthly plan but this price is one-time");
  } else if (price.recurring.interval !== "month" || price.recurring.interval_count !== 1) {
    fail("Checkout price interval", `bills every ${price.recurring.interval_count} ${price.recurring.interval}, site says monthly`);
  } else {
    pass("Checkout price interval", "monthly");
  }

  if (advertisedCents !== null && price.unit_amount !== advertisedCents) {
    fail(
      "Price matches the site",
      `site advertises ${money(advertisedCents, "usd")} but checkout charges ${money(price.unit_amount, price.currency)}`,
    );
  } else if (advertisedCents !== null) {
    pass("Price matches the site", "advertised and charged amounts agree");
  }
}

// ── The Payment Link the site falls back to ───────────────────────────────
if (!advertisedLink) {
  warn("Fallback Payment Link", "no window.STRIPE_LINK found in index.html");
} else {
  const links = await stripe("payment_links?limit=100&expand[]=data.line_items");
  const match = links.data.find((link) => link.url === advertisedLink.replace(/\?.*$/, ""));
  if (!match) {
    fail("Fallback Payment Link", `${advertisedLink} does not exist in this Stripe account`);
  } else if (!match.active) {
    fail("Fallback Payment Link", `${match.id} is deactivated, so the subscribe button leads to a dead page`);
  } else {
    const item = match.line_items?.data?.[0];
    const amount = item?.price?.unit_amount;
    pass("Fallback Payment Link", `${match.id} active — ${money(amount ?? 0, item?.price?.currency ?? "usd")}`);
    if (advertisedCents !== null && amount !== advertisedCents) {
      fail(
        "Payment Link price matches the site",
        `link charges ${money(amount ?? 0, item?.price?.currency ?? "usd")} but the site advertises ${money(advertisedCents, "usd")}`,
      );
    } else if (advertisedCents !== null) {
      pass("Payment Link price matches the site", "amounts agree");
    }

    // hosted_confirmation keeps the payer on Stripe, so the site never receives
    // ?session_id and verify-subscription cannot unlock access on return.
    if (match.after_completion?.type === "hosted_confirmation") {
      warn(
        "Payment Link returns the customer to the site",
        `${match.id} shows a Stripe confirmation page instead of redirecting back, so access depends entirely on the webhook`,
      );
    } else {
      pass("Payment Link returns the customer to the site", match.after_completion?.type ?? "redirect");
    }
  }
}

// ── Can Stripe reach the site at all? ─────────────────────────────────────
const secretConfigured =
  Boolean(process.env.STRIPE_WEBHOOK_SECRET) || Boolean(process.env.STRIPE_WEBHOOK_KEY);
if (secretConfigured) pass("Webhook signing secret", "configured");
else fail("Webhook signing secret", "set STRIPE_WEBHOOK_SECRET or the webhook returns 503 on every delivery");

const endpoints = await stripe("webhook_endpoints?limit=100");
const expected = new URL(WEBHOOK_PATH, SITE).toString();
const correct = endpoints.data.filter(
  (endpoint) => new URL(endpoint.url).pathname === WEBHOOK_PATH,
);

if (!endpoints.data.length) {
  fail("Webhook endpoint", "no webhook endpoint exists; payments will never grant access");
} else if (!correct.length) {
  fail(
    "Webhook endpoint path",
    `configured ${endpoints.data.map((e) => e.url).join(", ")} — none point at ${WEBHOOK_PATH}. ` +
      `The static site answers 200 there, so Stripe reports success while the function never runs. Expected ${expected}`,
  );
} else {
  for (const endpoint of correct) {
    if (endpoint.status !== "enabled") {
      fail("Webhook endpoint status", `${endpoint.url} is ${endpoint.status}`);
      continue;
    }
    pass("Webhook endpoint", `${endpoint.url} (enabled)`);

    const missing = REQUIRED_EVENTS.filter(
      (event) =>
        !endpoint.enabled_events.includes(event) && !endpoint.enabled_events.includes("*"),
    );
    if (missing.length) fail("Webhook events", `not subscribed to ${missing.join(", ")}`);
    else pass("Webhook events", "all events the code handles are subscribed");
  }
}

// ── Live reachability of the endpoint ─────────────────────────────────────
try {
  const probe = await fetch(expected, {
    method: "POST",
    headers: { "stripe-signature": "t=0,v1=probe" },
    body: "{}",
  });
  // 400 is the healthy answer: the function ran and rejected an unsigned body.
  if (probe.status === 400) {
    pass("Webhook endpoint is live", `${expected} rejects unsigned payloads (400), so the function is running`);
  } else if (probe.status === 404) {
    fail("Webhook endpoint is live", `${expected} returns 404 — the function is not deployed`);
  } else if (probe.status === 503) {
    fail("Webhook endpoint is live", `${expected} returns 503 — Stripe env vars missing in this environment`);
  } else {
    warn("Webhook endpoint is live", `${expected} returned ${probe.status}`);
  }
} catch (error) {
  warn("Webhook endpoint is live", `could not reach ${expected}: ${error.message}`);
}

// ── Are paying customers actually being served? ──────────────────────────
const subs = await stripe("subscriptions?status=all&limit=100");
const active = subs.data.filter((s) => ["active", "trialing"].includes(s.status));
pass(
  "Active subscriptions",
  active.length
    ? `${active.length} paying: ${active.map((s) => s.customer).join(", ")}`
    : "none yet",
);

// ── Analyzer credit packs ────────────────────────────────────────────────
// Packs are optional: with no price ids set the app just offers the
// subscription instead. But a price id that is set and *wrong* sells the
// customer the wrong thing, so anything configured gets checked properly.
const configuredPacks = CREDIT_CONFIG.packs.filter((pack) => process.env[pack.priceEnv]);

if (!configuredPacks.length) {
  warn(
    "Analyzer credit packs",
    `none configured (${CREDIT_CONFIG.packs.map((p) => p.priceEnv).join(", ")} unset), ` +
      "so the analyzer offers only the subscription. Run `npm run setup:credit-packs` to create them.",
  );
} else {
  for (const pack of CREDIT_CONFIG.packs) {
    const packPriceId = process.env[pack.priceEnv];
    if (!packPriceId) {
      warn(`Credit pack "${pack.id}"`, `${pack.priceEnv} not set, so this pack is not offered`);
      continue;
    }

    let packPrice;
    try {
      packPrice = await stripe(`prices/${packPriceId}?expand[]=product`);
    } catch (error) {
      fail(`Credit pack "${pack.id}"`, `${pack.priceEnv} does not resolve: ${error.message}`);
      continue;
    }

    const problems = [];
    if (!packPrice.active) problems.push("price is deactivated, so checkout will fail");
    if (packPrice.recurring) {
      problems.push(
        "price is recurring, but credit packs are one-time -- the customer would be " +
          "billed every month for a single pack",
      );
    }

    // The credits granted come from the Checkout session metadata the app sets,
    // not from Stripe. A mismatch here means the receipt and the balance disagree.
    const metaCredits = Number(packPrice.metadata?.credit_amount);
    if (Number.isFinite(metaCredits) && metaCredits !== pack.credits) {
      problems.push(
        `price metadata says ${metaCredits} credits but lib/credit-packs.mjs says ${pack.credits}`,
      );
    }
    const metaPackId = packPrice.metadata?.credit_pack_id;
    if (metaPackId && metaPackId !== pack.id) {
      problems.push(`price metadata credit_pack_id is "${metaPackId}", expected "${pack.id}"`);
    }

    if (problems.length) {
      fail(`Credit pack "${pack.id}"`, problems.join("; "));
      continue;
    }

    const amount = packPrice.unit_amount ?? 0;
    const detail =
      `${packPriceId} — ${money(amount, packPrice.currency)} for ${pack.credits} analyses ` +
      `(${money(Math.round(amount / pack.credits), packPrice.currency)} each)`;

    // Purely advisory: a pack that costs more than a month of unlimited access
    // is a worse deal than subscribing, which suppresses pack sales.
    if (advertisedCents && amount > advertisedCents) {
      warn(
        `Credit pack "${pack.id}"`,
        `${detail} — costs more than the $${(advertisedCents / 100).toFixed(2)}/month ` +
          "unlimited subscription, so it only appeals to buyers who refuse a recurring charge",
      );
    } else {
      pass(`Credit pack "${pack.id}"`, detail);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────
console.log("\nStripe configuration check\n" + "=".repeat(58));
for (const r of results) {
  const mark = !r.ok ? "FAIL" : r.warn ? "WARN" : "ok  ";
  console.log(`${mark}  ${r.label}${r.detail ? `\n      ${r.detail}` : ""}`);
}

const failures = results.filter((r) => !r.ok);
const warnings = results.filter((r) => r.ok && r.warn);
console.log("=".repeat(58));
console.log(`${results.length - failures.length - warnings.length} ok, ${warnings.length} warning(s), ${failures.length} failure(s)\n`);

if (failures.length) process.exit(1);
