/**
 * /api/admin -- the owner's single view of the site's people and email.
 *
 * GET merges Identity accounts, app accounts, Stripe entitlements, and
 * inner-circle / quiz contacts into one list keyed by email, alongside the
 * email log and a live check of the Brevo connection.
 *
 * POST { action: "confirm", userId }  force-confirms a stuck account
 * POST { action: "test-email" }       sends a test email to the owner
 *
 * Only signed-in owners (see lib/owner.mjs) get anything back.
 */
import { admin, getUser } from "@netlify/identity";
import { db } from "../../db/index.js";
import { listContacts, recentEmails } from "../../db/email.js";
import { appAccounts, stripeEntitlements } from "../../db/schema.js";
import { brevoStatus, emailLayout, sendEmail } from "../../lib/email.mjs";
import { listAllIdentityUsers } from "../../lib/identity-users.mjs";
import { isOwner, ownerEmails } from "../../lib/owner.mjs";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const lower = (value) => (value || "").trim().toLowerCase();

const buildPeople = ({ users, accounts, entitlements, contacts }) => {
  const people = new Map();
  const person = (email) => {
    const key = lower(email);
    if (!people.has(key)) {
      people.set(key, {
        email: key,
        name: null,
        identityUserId: null,
        accountCreatedAt: null,
        emailConfirmed: null,
        lastSignInAt: null,
        subscription: null,
        analysisCredits: null,
        analysesUsed: null,
        founderAccess: false,
        innerCircle: false,
        quizTaker: false,
        lastQuiz: null,
        firstSeenAt: null,
      });
    }
    return people.get(key);
  };
  const seen = (entry, date) => {
    const iso = date ? new Date(date).toISOString() : null;
    if (iso && (!entry.firstSeenAt || iso < entry.firstSeenAt)) entry.firstSeenAt = iso;
  };

  for (const user of users) {
    if (!user.email) continue;
    const entry = person(user.email);
    entry.identityUserId = user.id;
    entry.name = user.name || null;
    entry.accountCreatedAt = user.createdAt || null;
    entry.emailConfirmed = Boolean(user.confirmedAt);
    entry.lastSignInAt = user.lastSignInAt || null;
    seen(entry, user.createdAt);
  }

  const accountByCustomer = new Map();
  for (const account of accounts) {
    const entry = person(account.email);
    entry.analysisCredits = account.analysisCredits;
    entry.analysesUsed = account.analysesUsed;
    entry.founderAccess = account.founderAccess;
    seen(entry, account.createdAt);
    if (account.stripeCustomerId) accountByCustomer.set(account.stripeCustomerId, entry);
  }

  for (const entitlement of entitlements) {
    const entry =
      (entitlement.stripeCustomerId && accountByCustomer.get(entitlement.stripeCustomerId)) ||
      (entitlement.customerEmail ? person(entitlement.customerEmail) : null);
    if (!entry) continue;
    // Prefer an active entitlement over a stale one for the same person.
    if (!entry.subscription || entitlement.accessActive) {
      entry.subscription = {
        status: entitlement.status,
        active: entitlement.accessActive,
        since: entitlement.createdAt,
      };
    }
    seen(entry, entitlement.createdAt);
  }

  for (const contact of contacts) {
    const entry = person(contact.email);
    entry.name = entry.name || contact.firstName;
    entry.innerCircle = contact.innerCircle;
    entry.quizTaker = contact.quizTaker;
    entry.lastQuiz = contact.lastQuizName
      ? `${contact.lastQuizName}${contact.lastQuizResult ? ` (${contact.lastQuizResult})` : ""}`
      : null;
    seen(entry, contact.createdAt);
  }

  return [...people.values()].sort((a, b) => (b.firstSeenAt || "").localeCompare(a.firstSeenAt || ""));
};

export default async (req) => {
  const user = await getUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  if (!isOwner(user)) return json({ error: "This page is only for the site owner." }, 403);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));

    if (body.action === "confirm" && typeof body.userId === "string") {
      await admin.updateUser(body.userId, { confirm: true });
      return json({ ok: true });
    }

    if (body.action === "test-email") {
      const to = lower(user.email);
      const result = await sendEmail({
        kind: "test",
        to,
        subject: "Test email from Embodying Sane",
        html: emailLayout(
          `<p style="margin:0;line-height:1.7">This test email arrived, so email from your app is working.</p>`,
        ),
      });
      return json({ ok: result.ok, error: result.error || null, to }, result.ok ? 200 : 502);
    }

    return json({ error: "Unknown action" }, 400);
  }

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const [users, accounts, entitlements, contacts, emails, brevo] = await Promise.all([
    listAllIdentityUsers().catch((error) => {
      console.error("Could not list Identity users.", error);
      return [];
    }),
    db.select().from(appAccounts),
    db.select().from(stripeEntitlements),
    listContacts(),
    recentEmails(),
    brevoStatus(),
  ]);

  const people = buildPeople({ users, accounts, entitlements, contacts });

  return json({
    owner: ownerEmails(),
    brevo,
    totals: {
      people: people.length,
      accounts: people.filter((p) => p.identityUserId).length,
      unconfirmed: people.filter((p) => p.identityUserId && !p.emailConfirmed).length,
      activeSubscribers: people.filter((p) => p.subscription?.active).length,
      innerCircle: people.filter((p) => p.innerCircle).length,
      quizTakers: people.filter((p) => p.quizTaker).length,
      emailsFailed: emails.filter((e) => e.status === "failed").length,
    },
    people,
    emails,
  });
};

export const config = { path: "/api/admin" };
