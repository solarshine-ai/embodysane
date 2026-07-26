import { eq, or, sql } from "drizzle-orm";
import { db } from "./index.js";
import { stripeEntitlements } from "./schema.js";

type EntitlementUpdate = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  checkoutSessionId?: string | null;
  customerEmail?: string | null;
  status: string;
  accessActive: boolean;
  lastStripeEventId?: string | null;
  lastStripeEventCreatedAt?: Date | null;
};

export async function findStripeEntitlementBySessionId(checkoutSessionId: string) {
  const [entitlement] = await db
    .select()
    .from(stripeEntitlements)
    .where(eq(stripeEntitlements.checkoutSessionId, checkoutSessionId))
    .limit(1);

  return entitlement ?? null;
}

export async function findStripeEntitlementForAccount(
  stripeCustomerId: string | null,
  customerEmail: string,
) {
  const conditions = [];

  if (stripeCustomerId) {
    conditions.push(eq(stripeEntitlements.stripeCustomerId, stripeCustomerId));
  }
  conditions.push(
    sql`lower(${stripeEntitlements.customerEmail}) = ${customerEmail.toLowerCase()}`,
  );

  const [entitlement] = await db
    .select()
    .from(stripeEntitlements)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .limit(1);

  return entitlement ?? null;
}

export async function saveStripeEntitlement(update: EntitlementUpdate) {
  const identifiers = [];

  if (update.stripeCustomerId) {
    identifiers.push(eq(stripeEntitlements.stripeCustomerId, update.stripeCustomerId));
  }
  if (update.stripeSubscriptionId) {
    identifiers.push(eq(stripeEntitlements.stripeSubscriptionId, update.stripeSubscriptionId));
  }
  if (update.checkoutSessionId) {
    identifiers.push(eq(stripeEntitlements.checkoutSessionId, update.checkoutSessionId));
  }

  const [existing] = identifiers.length
    ? await db
        .select()
        .from(stripeEntitlements)
        .where(identifiers.length === 1 ? identifiers[0] : or(...identifiers))
        .limit(1)
    : [];

  if (existing?.lastStripeEventId === update.lastStripeEventId) {
    return existing;
  }

  if (existing) {
    const applyStatus =
      !existing.lastStripeEventCreatedAt ||
      (update.lastStripeEventCreatedAt !== null &&
        update.lastStripeEventCreatedAt !== undefined &&
        update.lastStripeEventCreatedAt >= existing.lastStripeEventCreatedAt);

    const [saved] = await db
      .update(stripeEntitlements)
      .set({
        stripeCustomerId: update.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId:
          update.stripeSubscriptionId ?? existing.stripeSubscriptionId,
        checkoutSessionId: update.checkoutSessionId ?? existing.checkoutSessionId,
        customerEmail: update.customerEmail ?? existing.customerEmail,
        status: applyStatus ? update.status : existing.status,
        accessActive: applyStatus ? update.accessActive : existing.accessActive,
        lastStripeEventId: applyStatus
          ? update.lastStripeEventId ?? existing.lastStripeEventId
          : existing.lastStripeEventId,
        lastStripeEventCreatedAt: applyStatus
          ? update.lastStripeEventCreatedAt ?? existing.lastStripeEventCreatedAt
          : existing.lastStripeEventCreatedAt,
        updatedAt: new Date(),
      })
      .where(eq(stripeEntitlements.id, existing.id))
      .returning();

    return saved;
  }

  const [saved] = await db
    .insert(stripeEntitlements)
    .values({
      stripeCustomerId: update.stripeCustomerId ?? null,
      stripeSubscriptionId: update.stripeSubscriptionId ?? null,
      checkoutSessionId: update.checkoutSessionId ?? null,
      customerEmail: update.customerEmail ?? null,
      status: update.status,
      accessActive: update.accessActive,
      lastStripeEventId: update.lastStripeEventId ?? null,
      lastStripeEventCreatedAt: update.lastStripeEventCreatedAt ?? null,
    })
    .returning();

  return saved;
}
