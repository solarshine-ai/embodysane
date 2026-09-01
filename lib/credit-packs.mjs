/**
 * Analyzer credit configuration -- the single source of truth.
 *
 * Kept as plain JavaScript, with no database or Stripe imports, so it can be
 * read by three very different callers without dragging a connection along:
 *
 *   db/credits.ts                 enforcement and balances at runtime
 *   scripts/setup-credit-packs    creating the Stripe prices
 *   scripts/check-stripe-config   verifying pack prices still match
 *
 * Everything commercial about credits lives here. Change a number and the whole
 * app follows: enforcement, the analyzer badge, the account endpoint, and the
 * buy-credits sheet.
 */

/**
 * `subscriberMonthlyCredits` is the one decision worth making deliberately:
 *
 *   null  Subscribers get unlimited analyses. This is the current setting
 *         because it is what the site advertises ("Unlimited Conversation
 *         Analyzer") and what the existing subscriber already pays for.
 *         Changing it retroactively would alter their terms mid-subscription.
 *
 *   N     Subscribers get N analyses per month, topped up on renewal, and can
 *         buy packs beyond that. Use this if analyzer API spend needs a ceiling
 *         per customer. If you switch, update the pricing copy in index.html —
 *         "Unlimited" would no longer be true.
 */
export const CREDIT_CONFIG = {
  /** Credits a brand-new account starts with, before paying anything. */
  signupCredits: 3,

  /** null = unlimited for active subscribers. A number = monthly allowance. */
  subscriberMonthlyCredits: null,

  /** Credits consumed by one analyzer run. */
  costPerAnalysis: 1,

  /**
   * Purchasable credit packs. `priceEnv` names the Netlify environment variable
   * holding the Stripe *one-time* price id for that pack.
   *
   * A pack with no configured price id is simply not offered, so the app
   * degrades to "subscribe instead" rather than showing a broken button.
   *
   * Note on pricing: the subscription is $3.69/month for unlimited, so any pack
   * priced above that is irrational for a buyer who is willing to subscribe.
   * Packs are worth selling mainly to people who refuse a recurring charge.
   */
  packs: [
    { id: "starter", label: "5 analyses", credits: 5, priceEnv: "STRIPE_CREDITS_5_PRICE_ID" },
    { id: "standard", label: "15 analyses", credits: 15, priceEnv: "STRIPE_CREDITS_15_PRICE_ID" },
    { id: "bulk", label: "40 analyses", credits: 40, priceEnv: "STRIPE_CREDITS_40_PRICE_ID" },
  ],
};
