import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@netlify/identity";
import { accountAccess, ensureAppAccount } from "../../db/accounts.js";
import {
  consumeAnalysisCredit,
  creditState,
  refreshSubscriberAllowance,
  refundAnalysisCredit,
} from "../../db/credits.js";
import { reconcileStripeAccess } from "../../lib/stripe-access.mjs";

const SYSTEM_PROMPT = `You are a relationship pattern analyst for Embodying Sane. Respond ONLY with valid JSON: {"overallRisk":"Low"|"Moderate"|"High"|"Severe","summary":"2-3 sentences","patterns":[{"name":"string","severity":"mild"|"moderate"|"severe","quote":"brief example","explanation":"1 sentence"}],"healthySignals":["positive signals if any"],"affirmation":"one empowering sentence for the reader"}`;

const anthropic = new Anthropic();

// `netlifyContext` rather than `context`, because the request body already
// carries a user-supplied `context` string for the analysis itself.
export default async (req, netlifyContext) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Set once a credit has actually been taken, so a failure further down can
  // hand it back instead of charging for nothing.
  let chargedFor = null;

  try {
    const user = await getUser();
    if (!user?.id || !user.email) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const { account, entitlement } = await ensureAppAccount({
      id: user.id,
      email: user.email,
    });
    let access = accountAccess(account, entitlement);
    if (!access.active) {
      // Never turn a paying customer away on the strength of the database
      // alone. Confirm against Stripe first, so a missed webhook cannot cost
      // someone the feature they are being charged for.
      const reconciled = await reconcileStripeAccess({
        account,
        entitlement,
        identityUserId: user.id,
        email: user.email,
        context: netlifyContext,
      });
      access = accountAccess(account, reconciled);
    }
    if (!access.active) {
      return Response.json({ error: "Active access required" }, { status: 403 });
    }

    // Validate the request *before* spending a credit, so a malformed submission
    // never costs the customer anything.
    const body = await req.json();
    const { mode, text, imageData, context } = body;

    if (!mode || (mode === "paste" && !text) || (mode === "photo" && !imageData)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Top up a metered subscriber's monthly allowance if it is due, then take
    // payment for this run. This is the only place analyzer usage is counted --
    // the browser's copy is display only, so clearing site data no longer buys
    // free analyses on the Anthropic API's tab.
    const funded = await refreshSubscriberAllowance(
      account,
      access.subscriptionActive,
    );
    const charged = await consumeAnalysisCredit(funded, access.subscriptionActive);

    if (!charged) {
      return Response.json(
        {
          error: "Out of analyzer credits",
          credits: creditState(funded, access.subscriptionActive),
        },
        { status: 402 },
      );
    }
    chargedFor = user.id;

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

    // Ship the new balance alongside the result so the analyzer badge reflects
    // the server's count rather than a number the browser kept for itself.
    return new Response(
      JSON.stringify({
        ...message,
        credits: creditState(charged, access.subscriptionActive),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Analysis failed.", e);
    if (chargedFor) {
      // The customer got nothing, so they keep their credit.
      await refundAnalysisCredit(chargedFor).catch((refundError) => {
        console.error(
          `Could not refund an analyzer credit to ${chargedFor}.`,
          refundError,
        );
      });
    }
    return new Response(JSON.stringify({ error: "Analysis failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/analyze",
};
