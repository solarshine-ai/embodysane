/**
 * Creates the Stripe one-time prices for analyzer credit packs, then prints the
 * environment variables to set.
 *
 * This is a deliberate manual step rather than something the app does on its
 * own: it creates real, sellable products in a live Stripe account at prices
 * that are a business decision, not a technical one. Read PACK_PRICING below,
 * change the numbers to what you actually want to charge, then run:
 *
 *   npm run setup:credit-packs
 *
 * Safe to re-run. It reuses the existing product and skips any pack that
 * already has a matching active price, so it will not litter your account with
 * duplicates. Changing a number and re-running creates the new price and tells
 * you the new id -- Stripe prices are immutable, so the old one is left alone
 * for anyone mid-checkout.
 */
import { CREDIT_CONFIG } from "../lib/credit-packs.mjs";

// ── EDIT ME ────────────────────────────────────────────────────────────────
// Price per pack, in cents. Pack sizes come from CREDIT_CONFIG in lib/credit-packs.mjs.
//
// Sanity check before you run this: the subscription is $3.69/month for
// unlimited analyses. A pack that costs more than that per month of typical use
// is a worse deal than subscribing, which is fine for someone who refuses a
// recurring charge but means packs will never be the main seller. If you want
// packs to carry the business, raise the subscription price first.
const PACK_PRICING = {
  starter: 249, // 5 analyses  -> $2.49
  standard: 599, // 15 analyses -> $5.99
  bulk: 1299, // 40 analyses -> $12.99
};
// ───────────────────────────────────────────────────────────────────────────

const PRODUCT_NAME = "Embody Sane Analysis Credits";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(2);
}

const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

const stripe = async (path, body) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: auth,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  const json = await response.json();
  if (json.error) throw new Error(`Stripe ${path}: ${json.error.message}`);
  return json;
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// ── Find or create the product ────────────────────────────────────────────
const existingProducts = await stripe("products?limit=100&active=true");
let product = existingProducts.data.find((p) => p.name === PRODUCT_NAME);

if (product) {
  console.log(`Reusing product ${product.id} (${PRODUCT_NAME})`);
} else {
  product = await stripe("products", {
    name: PRODUCT_NAME,
    description: "Prepaid Conversation Analyzer runs.",
  });
  console.log(`Created product ${product.id} (${PRODUCT_NAME})`);
}

// ── Find or create a price per pack ───────────────────────────────────────
const existingPrices = await stripe(`prices?limit=100&product=${product.id}`);
const envLines = [];

for (const pack of CREDIT_CONFIG.packs) {
  const amount = PACK_PRICING[pack.id];
  if (!Number.isInteger(amount) || amount <= 0) {
    console.error(`  skip ${pack.id}: no valid price in PACK_PRICING`);
    continue;
  }

  const match = existingPrices.data.find(
    (price) =>
      price.active &&
      !price.recurring &&
      price.unit_amount === amount &&
      price.metadata?.credit_pack_id === pack.id,
  );

  let price = match;
  if (price) {
    console.log(`  reuse ${pack.id}: ${price.id} — ${money(amount)} for ${pack.credits}`);
  } else {
    price = await stripe("prices", {
      product: product.id,
      currency: "usd",
      unit_amount: String(amount),
      nickname: `${pack.credits} analyses`,
      "metadata[credit_pack_id]": pack.id,
      "metadata[credit_amount]": String(pack.credits),
    });
    console.log(`  create ${pack.id}: ${price.id} — ${money(amount)} for ${pack.credits}`);
  }

  envLines.push(`${pack.priceEnv}=${price.id}`);
}

// ── What to do next ───────────────────────────────────────────────────────
console.log(
  "\nSet these in the Netlify UI (Site configuration -> Environment variables).\n" +
    "Credit packs stay hidden in the app until they are set:\n",
);
for (const line of envLines) console.log(`  ${line}`);
console.log("\nThen run `npm run verify:stripe` to confirm everything matches.\n");
