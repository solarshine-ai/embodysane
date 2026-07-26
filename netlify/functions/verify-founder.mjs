import { getUser } from "@netlify/identity";
import { ensureAppAccount, grantFounderAccess } from "../../db/accounts.js";

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
      return Response.json({ valid: false, error: "Sign in required" }, { status: 401 });
    }

    const { code } = await req.json();
    const founderCode = Netlify.env.get("FOUNDER_ACCESS_CODE");

    if (!founderCode || !code) {
      return Response.json({ valid: false }, { status: 401 });
    }

    if (code === founderCode) {
      await ensureAppAccount({ id: user.id, email: user.email });
      await grantFounderAccess(user.id);
      return Response.json({ valid: true });
    }

    return Response.json({ valid: false }, { status: 401 });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
};

export const config = {
  path: "/api/verify-founder",
};
