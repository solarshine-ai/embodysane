import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./index.js";
import { emailContacts, emailLog, signInTokens } from "./schema.js";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

type ContactUpdate = {
  email: string;
  firstName?: string | null;
  innerCircle?: boolean;
  quizName?: string | null;
  quizResult?: string | null;
};

/** Inserts or updates a contact, returning it and whether it is brand new. */
export async function upsertContact(update: ContactUpdate) {
  const email = normalizeEmail(update.email);
  const quizTaker = Boolean(update.quizName);
  const [existing] = await db
    .select()
    .from(emailContacts)
    .where(eq(emailContacts.email, email))
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(emailContacts)
      .values({
        email,
        firstName: update.firstName || null,
        innerCircle: update.innerCircle === true,
        quizTaker,
        lastQuizName: update.quizName || null,
        lastQuizResult: update.quizResult || null,
      })
      .onConflictDoNothing({ target: emailContacts.email })
      .returning();
    if (created) return { contact: created, isNew: true, joinedInnerCircle: created.innerCircle };
  }

  const [saved] = await db
    .update(emailContacts)
    .set({
      ...(update.firstName ? { firstName: update.firstName } : {}),
      ...(update.innerCircle ? { innerCircle: true } : {}),
      ...(quizTaker
        ? { quizTaker: true, lastQuizName: update.quizName, lastQuizResult: update.quizResult || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailContacts.email, email))
    .returning();

  return {
    contact: saved,
    isNew: false,
    joinedInnerCircle: update.innerCircle === true && existing?.innerCircle !== true,
  };
}

export async function listContacts() {
  return db.select().from(emailContacts).orderBy(desc(emailContacts.createdAt));
}

type LogEntry = {
  kind: string;
  toEmail: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  error?: string | null;
  providerMessageId?: string | null;
};

export async function logEmail(entry: LogEntry) {
  await db.insert(emailLog).values({
    kind: entry.kind,
    toEmail: normalizeEmail(entry.toEmail),
    subject: entry.subject.slice(0, 300),
    status: entry.status,
    error: entry.error ? entry.error.slice(0, 1000) : null,
    providerMessageId: entry.providerMessageId ?? null,
  });
}

export async function recentEmails(limit = 200) {
  return db.select().from(emailLog).orderBy(desc(emailLog.createdAt)).limit(limit);
}

export async function createSignInToken(params: {
  tokenHash: string;
  email: string;
  purpose: string;
  expiresAt: Date;
}) {
  await db.insert(signInTokens).values({
    tokenHash: params.tokenHash,
    email: normalizeEmail(params.email),
    purpose: params.purpose,
    expiresAt: params.expiresAt,
  });
}

/** Links requested for this address since `since`, newest first. */
export async function recentSignInTokens(email: string, since: Date) {
  return db
    .select({ createdAt: signInTokens.createdAt })
    .from(signInTokens)
    .where(and(eq(signInTokens.email, normalizeEmail(email)), gt(signInTokens.createdAt, since)))
    .orderBy(desc(signInTokens.createdAt));
}

/**
 * Marks an unexpired, unused token as used and returns it. The single UPDATE
 * makes a link work exactly once even if it is opened twice at the same time.
 */
export async function consumeSignInToken(tokenHash: string) {
  const [token] = await db
    .update(signInTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(signInTokens.tokenHash, tokenHash),
        isNull(signInTokens.usedAt),
        gt(signInTokens.expiresAt, sql`now()`),
      ),
    )
    .returning();
  return token ?? null;
}
