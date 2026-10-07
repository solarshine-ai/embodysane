/**
 * POST /api/auth/magic-link -- emails a one-time sign-in link through Brevo.
 *
 * This replaces Netlify Identity's built-in recovery email, which depends on
 * the Identity SMTP settings in the dashboard. The app now sends the link
 * itself through the same Brevo connection as every other email, so sign-in
 * works as long as that one connection does. The same link serves new
 * visitors (the account is created when they open it), returning users, and
 * "forgot password".
 */
import crypto from "node:crypto";
import { verifyRequestOrigin } from "@netlify/identity";
import { createSignInToken, recentSignInTokens } from "../../db/email.js";
import { emailButton, emailLayout, sendEmail, SITE_URL } from "../../lib/email.mjs";
import { hashToken } from "../../lib/tokens.mjs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_LIFETIME_MINUTES = 60;
const MAX_LINKS_PER_HOUR = 5;
const MIN_SECONDS_BETWEEN_LINKS = 45;

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    verifyRequestOrigin(req);
  } catch {
    return Response.json({ error: "Request not allowed" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const purpose = body.purpose === "reset" || body.purpose === "signup" ? body.purpose : "signin";
    if (!emailPattern.test(email) || email.length > 200) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    const recent = await recentSignInTokens(email, new Date(Date.now() - 60 * 60 * 1000));
    if (recent.length >= MAX_LINKS_PER_HOUR) {
      return Response.json(
        { error: "Several links were already sent this hour. Use the newest one in your inbox (check spam too), or try again later." },
        { status: 429 },
      );
    }
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_LINKS * 1000) {
      return Response.json(
        { error: "A link was just sent. Give it a minute to arrive and check your spam folder." },
        { status: 429 },
      );
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await createSignInToken({
      tokenHash: hashToken(token),
      email,
      purpose,
      expiresAt: new Date(Date.now() + LINK_LIFETIME_MINUTES * 60 * 1000),
    });

    // The token travels in the URL fragment, which browsers never send to a
    // server. Mail scanners that pre-open links therefore cannot use it up.
    const link = `${SITE_URL}/#signin_token=${token}`;
    const action = purpose === "reset" ? "Reset my password" : purpose === "signup" ? "Create my account" : "Sign me in";
    const intro =
      purpose === "reset"
        ? "Use this button to sign in and choose a new password."
        : purpose === "signup"
          ? "Welcome. Use this button to finish creating your account."
          : "Use this button to sign in to your account.";
    const result = await sendEmail({
      kind: `sign-in-link:${purpose}`,
      to: email,
      subject: purpose === "reset" ? "Reset your Embodying Sane password" : "Your Embodying Sane sign-in link",
      html: emailLayout(
        `<p style="margin:0 0 16px;line-height:1.7">${intro}</p>` +
          emailButton(link, action) +
          `<p style="margin:0;line-height:1.7;color:#9d93b8;font-size:14px">The link works once and expires in ${LINK_LIFETIME_MINUTES} minutes.</p>`,
        "If you didn't ask for this, you can ignore this email. Nobody can sign in without the link.",
      ),
    });

    if (!result.ok) {
      return Response.json(
        { error: "We couldn't send the email right now. Please try again shortly, or contact support@embodysane.com." },
        { status: 503 },
      );
    }
    return Response.json({ sent: true });
  } catch (error) {
    console.error("Magic-link request failed.", error);
    return Response.json({ error: "Unable to send a sign-in link right now" }, { status: 503 });
  }
};

export const config = {
  path: "/api/auth/magic-link",
  method: "POST",
};
