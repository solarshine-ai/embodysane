import { track } from "@vercel/analytics/server";

const allowedEvents = new Set([
  "assessment_started",
  "lead_capture_submitted",
  "analyzer_started",
  "checkout_started",
]);

export default async function handler(request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { event } = await request.json();
    if (!allowedEvents.has(event)) {
      return Response.json({ error: "Unknown event" }, { status: 400 });
    }

    await track(event);
    return Response.json({ tracked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to track event" }, { status: 400 });
  }
}
