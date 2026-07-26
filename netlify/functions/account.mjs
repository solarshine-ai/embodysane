import { getUser } from "@netlify/identity";
import {
  accountAccess,
  clearAccountData,
  ensureAppAccount,
  saveAccountData,
} from "../../db/accounts.js";

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const normalizeData = (value) => {
  if (!value || typeof value !== "object") return null;
  const diary = Array.isArray(value.diary) ? value.diary.slice(0, 2000) : [];
  const vault = Array.isArray(value.vault) ? value.vault.slice(0, 2000) : [];
  const freeAnalyses = Number.isFinite(value.freeAnalyses)
    ? Math.max(0, Math.min(1000, Math.trunc(value.freeAnalyses)))
    : 2;
  const daily = value.dailyAnalyses;
  const dailyAnalyses = {
    date: typeof daily?.date === "string" ? daily.date.slice(0, 20) : "",
    count: Number.isFinite(daily?.count)
      ? Math.max(0, Math.min(1000, Math.trunc(daily.count)))
      : 0,
  };

  return { diary, vault, freeAnalyses, dailyAnalyses };
};

const authenticatedAccount = async () => {
  const user = await getUser();
  if (!user?.id || !user.email) return null;
  const linked = await ensureAppAccount({ id: user.id, email: user.email });
  return { user, ...linked };
};

export default async (req) => {
  const current = await authenticatedAccount();
  if (!current) return json({ error: "Authentication required" }, 401);

  if (req.method === "GET") {
    return json({
      user: { id: current.user.id, email: current.user.email },
      data: current.account.accountData,
      dataInitialized: current.account.dataInitialized,
      access: accountAccess(current.account, current.entitlement),
    });
  }

  if (req.method === "PUT") {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 1_000_000) return json({ error: "Data is too large" }, 413);

    const body = await req.json();
    const accountData = normalizeData(body.data);
    if (!accountData) return json({ error: "Invalid account data" }, 400);

    let trialStartedAt;
    if (typeof body.trialStartedAt === "string") {
      const candidate = new Date(body.trialStartedAt);
      if (
        Number.isFinite(candidate.getTime()) &&
        candidate.getTime() <= Date.now() &&
        candidate < current.account.trialStartedAt
      ) {
        trialStartedAt = candidate;
      }
    }

    const account = await saveAccountData(
      current.user.id,
      accountData,
      trialStartedAt,
    );
    return json({
      saved: true,
      access: accountAccess(account, current.entitlement),
    });
  }

  if (req.method === "DELETE") {
    const account = await clearAccountData(current.user.id);
    return json({
      cleared: true,
      access: accountAccess(account, current.entitlement),
    });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/account" };
