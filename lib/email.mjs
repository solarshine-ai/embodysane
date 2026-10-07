/**
 * The one place this app sends email from.
 *
 * Every message -- sign-in links, quiz results, inner-circle welcomes and the
 * owner's alerts -- goes through Brevo's API with the EMAIL_API_KEY set on the
 * site, and every attempt is written to the email_log table so its outcome
 * shows up on the admin page.
 *
 * Env vars:
 *   EMAIL_API_KEY    required, marked secret. A Brevo *API*
 *                    key from Brevo > SMTP & API > API Keys, starting
 *                    "xkeysib-". SMTP keys ("xsmtpsib-") do not work with the API.
 *   EMAIL_FROM       optional. A sender verified in Brevo (Senders, Domains &
 *                    Dedicated IPs). Defaults to the owner address, which is
 *                    normally the Brevo account's own, already-verified email.
 *   EMAIL_FROM_NAME  optional. Defaults to "Embodying Sane".
 *   OWNER_EMAIL      optional. Who gets alerts and the admin page.
 *   BREVO_LIST_ID    optional. Contact list for signups. When unset, a list
 *                    named "Embodying Sane Inner Circle" is found or created.
 */
import { logEmail } from "../db/email.js";
import { ownerEmails } from "./owner.mjs";

const BREVO_API = "https://api.brevo.com/v3";
const DEFAULT_LIST_NAME = "Embodying Sane Inner Circle";

export const SITE_URL = "https://embodysane.com";

const brevoKey = () => (Netlify.env.get("EMAIL_API_KEY") || "").trim();

export const senderAddress = () =>
  Netlify.env.get("EMAIL_FROM") || ownerEmails()[0];

const brevoFetch = (path, init = {}) =>
  fetch(`${BREVO_API}${path}`, {
    ...init,
    headers: {
      "api-key": brevoKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Wraps body HTML in the app's dark, gold-accented email card. */
export const emailLayout = (bodyHtml, footer = "") => `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#07091a;font-family:Georgia,'Times New Roman',serif;color:#f0eafa">
  <div style="max-width:560px;margin:0 auto;background:#0d1230;border:1px solid rgba(201,168,76,0.15);border-radius:16px;padding:32px">
    <p style="color:#c9a84c;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 20px">Embodying Sane</p>
    ${bodyHtml}
    ${footer ? `<p style="margin:24px 0 0;color:#5f5678;font-size:12px">${footer}</p>` : ""}
  </div>
</body></html>`;

export const emailButton = (href, label) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#c9a84c;color:#07091a;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;font-family:Arial,sans-serif;font-size:14px">${escapeHtml(label)}</a></p>`;

/**
 * Sends one email and records the outcome. Never throws: returns
 * { ok, error } so callers decide whether a failed send should fail the
 * request (sign-in links) or just be logged (alerts).
 */
export async function sendEmail({ kind, to, toName, subject, html }) {
  const record = async (status, error = null, providerMessageId = null) => {
    try {
      await logEmail({ kind, toEmail: to, subject, status, error, providerMessageId });
    } catch (logError) {
      console.error("Could not write to email_log.", logError);
    }
  };

  if (!brevoKey()) {
    await record("failed", "EMAIL_API_KEY is not set");
    console.error(`Email "${kind}" not sent: EMAIL_API_KEY is not set.`);
    return { ok: false, error: "Email is not configured" };
  }

  try {
    const response = await brevoFetch("/smtp/email", {
      method: "POST",
      body: JSON.stringify({
        sender: { email: senderAddress(), name: Netlify.env.get("EMAIL_FROM_NAME") || "Embodying Sane" },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        subject,
        htmlContent: html,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = `Brevo ${response.status}: ${body.message || body.code || "send failed"}`;
      await record("failed", error);
      console.error(`Email "${kind}" failed. ${error}`);
      return { ok: false, error };
    }
    await record("sent", null, body.messageId || null);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record("failed", message);
    console.error(`Email "${kind}" threw.`, error);
    return { ok: false, error: message };
  }
}

/** Emails the owner(s). Alerts must never break the request that raised them. */
export async function notifyOwner(subject, lines) {
  const html = emailLayout(
    `<p style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</p>` +
      lines.map((line) => `<p style="margin:0 0 10px;line-height:1.6;color:#d8d0ea">${escapeHtml(line)}</p>`).join("") +
      emailButton(`${SITE_URL}/admin`, "Open Admin"),
    "You get these alerts because you own embodysane.com.",
  );
  await Promise.all(
    ownerEmails().map((to) =>
      sendEmail({ kind: "owner-alert", to, subject: `[Embodying Sane] ${subject}`, html }),
    ),
  );
}

/** Reports whether the Brevo key works, for the admin page's status panel. */
export async function brevoStatus() {
  if (!brevoKey()) return { ok: false, error: "EMAIL_API_KEY is not set on the site." };
  if (brevoKey().startsWith("xsmtpsib-")) {
    return {
      ok: false,
      error: "The saved key is a Brevo SMTP key (starts xsmtpsib-). The app needs a Brevo API key, which starts xkeysib-.",
    };
  }
  try {
    const response = await brevoFetch("/account");
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 401
            ? "Brevo rejected the API key (it was deleted, mistyped, or is an SMTP key rather than an API key)."
            : `Brevo returned ${response.status}: ${body.message || "unknown error"}`,
      };
    }
    return { ok: true, account: body.email || null, sender: senderAddress() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const resolveListId = async () => {
  const configured = Number.parseInt(Netlify.env.get("BREVO_LIST_ID") ?? "", 10);
  if (Number.isFinite(configured)) return configured;

  const lists = await brevoFetch("/contacts/lists?limit=50").then((r) => (r.ok ? r.json() : null));
  const found = lists?.lists?.find((list) => list.name === DEFAULT_LIST_NAME);
  if (found) return found.id;

  let folders = await brevoFetch("/contacts/folders?limit=50").then((r) => (r.ok ? r.json() : null));
  let folderId = folders?.folders?.[0]?.id;
  if (!folderId) {
    const created = await brevoFetch("/contacts/folders", {
      method: "POST",
      body: JSON.stringify({ name: "Embodying Sane" }),
    }).then((r) => (r.ok ? r.json() : null));
    folderId = created?.id;
  }
  if (!folderId) return null;

  const createdList = await brevoFetch("/contacts/lists", {
    method: "POST",
    body: JSON.stringify({ name: DEFAULT_LIST_NAME, folderId }),
  }).then((r) => (r.ok ? r.json() : null));
  return createdList?.id ?? null;
};

/**
 * Adds or updates a contact on the Brevo mailing list, so the owner can send
 * newsletters from Brevo. The app's own email_contacts table stays the record
 * of truth; this is best-effort.
 */
export async function addToMailingList(email, attributes = {}) {
  if (!brevoKey()) return;
  try {
    const listId = await resolveListId();
    if (!listId) {
      console.error("Could not find or create the Brevo contact list.");
      return;
    }
    const response = await brevoFetch("/contacts", {
      method: "POST",
      body: JSON.stringify({ email, attributes, listIds: [listId], updateEnabled: true }),
    });
    if (!response.ok) {
      console.error("Brevo contact upsert failed.", response.status, await response.text().catch(() => ""));
    }
  } catch (error) {
    console.error("Brevo contact upsert threw.", error);
  }
}
