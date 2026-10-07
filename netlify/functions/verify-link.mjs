/**
 * POST /api/auth/verify-link -- redeems a sign-in link from /api/auth/magic-link.
 *
 * Opening the link proves the visitor controls the inbox, so the account is
 * created on first use (already confirmed) and an existing one that was stuck
 * unconfirmed gets confirmed. The session is set by logging in server-side with
 * a fresh random password, which sets the normal nf_jwt / nf_refresh cookies;
 * the browser then picks those up with hydrateSession() and is offered the
 * chance to choose a password of its own.
 */
import crypto from "node:crypto";
import { admin, AuthError, login, verifyRequestOrigin } from "@netlify/identity";
import { consumeSignInToken } from "../../db/email.js";
import { notifyOwner } from "../../lib/email.mjs";
import { findIdentityUserByEmail } from "../../lib/identity-users.mjs";
import { hashToken } from "../../lib/tokens.mjs";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    verifyRequestOrigin(req);
  } catch {
    return json({ error: "Request not allowed" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 200) return json({ error: "This link is not valid." }, 400);

  try {
    const record = await consumeSignInToken(hashToken(token));
    if (!record) {
      return json(
        { error: "This link has expired or was already used. Request a new one and use the newest email." },
        410,
      );
    }

    const password = crypto.randomBytes(36).toString("base64url");
    let created = false;
    let wasUnconfirmed = false;
    let user;

    try {
      user = await admin.createUser({
        email: record.email,
        password,
        data: { user_metadata: { preferred_login: "email_link" } },
      });
      created = true;
    } catch (error) {
      if (!(error instanceof AuthError) || ![400, 409, 422].includes(error.status)) throw error;
      user = await findIdentityUserByEmail(record.email);
      if (!user) throw error;
      wasUnconfirmed = !user.confirmedAt;
      await admin.updateUser(user.id, { password, confirm: true });
    }

    await login(record.email, password);

    if (created || wasUnconfirmed) {
      await notifyOwner(created ? "New account created" : "Stuck account confirmed", [
        `Email: ${record.email}`,
        created
          ? "They opened their email link and their account is ready."
          : "This person had signed up earlier but never got their confirmation email. Their email link has now confirmed the account.",
      ]);
    }

    return json({ signedIn: true, purpose: record.purpose, created });
  } catch (error) {
    console.error("Sign-in link redemption failed.", error);
    return json({ error: "We couldn't sign you in with that link. Please request a new one." }, 503);
  }
};

export const config = {
  path: "/api/auth/verify-link",
  method: "POST",
};
