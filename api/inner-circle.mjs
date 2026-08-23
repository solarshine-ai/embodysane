import { track } from "@vercel/analytics/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { email, consent } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!emailPattern.test(normalizedEmail) || consent !== true) {
      return Response.json(
        { error: "A valid email address and consent are required" },
        { status: 400 },
      );
    }

    const destination = process.env.LEAD_CAPTURE_WEBHOOK_URL;
    if (!destination) {
      return Response.json(
        { error: "Inner-circle signup is not configured" },
        { status: 503 },
      );
    }

    const response = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, source: "embodysane.com" }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return Response.json({ error: "Unable to save your signup" }, { status: 502 });
    }

    await track("lead_capture_submitted");
    return Response.json({ subscribed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to save your signup" }, { status: 500 });
  }
}
