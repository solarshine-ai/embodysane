import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@netlify/identity";
import { accountAccess, ensureAppAccount } from "../../db/accounts.js";

const SYSTEM_PROMPT = `You are a relationship pattern analyst for Embodying Sane. Respond ONLY with valid JSON: {"overallRisk":"Low"|"Moderate"|"High"|"Severe","summary":"2-3 sentences","patterns":[{"name":"string","severity":"mild"|"moderate"|"severe","quote":"brief example","explanation":"1 sentence"}],"healthySignals":["positive signals if any"],"affirmation":"one empowering sentence for the reader"}`;

const anthropic = new Anthropic();

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const user = await getUser();
    if (!user?.id || !user.email) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const { account, entitlement } = await ensureAppAccount({
      id: user.id,
      email: user.email,
    });
    if (!accountAccess(account, entitlement).active) {
      return Response.json({ error: "Active access required" }, { status: 403 });
    }

    const body = await req.json();
    const { mode, text, imageData, context } = body;

    if (!mode || (mode === "paste" && !text) || (mode === "photo" && !imageData)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const contextStr = context?.trim()
      ? `\n\nContext from the user: "${context.trim()}"`
      : "";

    let content;
    if (mode === "photo") {
      content = [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: imageData },
        },
        {
          type: "text",
          text: `Analyze this conversation screenshot for manipulation patterns.${contextStr} Return ONLY valid JSON, no markdown, no backticks.`,
        },
      ];
    } else {
      content = [
        {
          type: "text",
          text: `Analyze this conversation for manipulation patterns:${contextStr}\n\n${text}\n\nReturn ONLY valid JSON, no markdown, no backticks.`,
        },
      ];
    }

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    return new Response(JSON.stringify(message), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Analysis failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/analyze",
};
