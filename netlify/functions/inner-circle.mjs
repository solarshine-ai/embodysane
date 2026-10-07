/**
 * POST /api/inner-circle -- the Home screen "Join our inner circle" signup.
 *
 * Saves the address to email_contacts (visible on /admin), adds it to the
 * Brevo mailing list so newsletters can go out from Brevo, sends a welcome
 * email, and alerts the owner.
 */
import { upsertContact } from "../../db/email.js";
import { addToMailingList, emailLayout, notifyOwner, sendEmail } from "../../lib/email.mjs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // Hidden honeypot field: real visitors never fill it in.
  if (body.website) return Response.json({ joined: true });
  if (!emailPattern.test(email) || email.length > 200) {
    return Response.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  try {
    const { joinedInnerCircle } = await upsertContact({ email, innerCircle: true });
    if (!joinedInnerCircle) return Response.json({ joined: true, already: true });

    await addToMailingList(email, { INNER_CIRCLE: true });
    await sendEmail({
      kind: "inner-circle-welcome",
      to: email,
      subject: "Welcome to the Embodying Sane inner circle",
      html: emailLayout(
        `<p style="margin:0 0 16px;line-height:1.7">Welcome to the inner circle.</p>
         <p style="margin:0 0 16px;line-height:1.7">You'll receive self-discovery insights, pattern analysis and tools for healing, straight to this inbox.</p>
         <p style="margin:0;line-height:1.7;color:#9d93b8">The knowledge is yours.</p>`,
        "You received this because you joined the inner circle at embodysane.com. Reply to this email any time to stop receiving updates.",
      ),
    });
    await notifyOwner("New inner circle member", [`Email: ${email}`]);
    return Response.json({ joined: true });
  } catch (error) {
    console.error("Inner circle signup failed.", error);
    return Response.json({ error: "That didn't go through. Please try again." }, { status: 503 });
  }
};

export const config = {
  path: "/api/inner-circle",
  method: "POST",
};
