import crypto from "node:crypto";
import {
  admin,
  AuthError,
  requestPasswordRecovery,
  verifyRequestOrigin,
} from "@netlify/identity";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    verifyRequestOrigin(req);
    const { email: rawEmail } = await req.json();
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    try {
      await admin.createUser({
        email,
        password: crypto.randomBytes(48).toString("base64url"),
        data: { user_metadata: { preferred_login: "magic_link" } },
      });
    } catch (error) {
      if (!(error instanceof AuthError) || ![400, 409, 422].includes(error.status)) {
        throw error;
      }
    }

    await requestPasswordRecovery(email);
    return Response.json({ sent: true });
  } catch (error) {
    console.error("Magic-link request failed.", error);
    return Response.json(
      { error: "Unable to send a sign-in link right now" },
      { status: error instanceof AuthError && error.status === 403 ? 403 : 503 },
    );
  }
};

export const config = {
  path: "/api/auth/magic-link",
  method: "POST",
};
