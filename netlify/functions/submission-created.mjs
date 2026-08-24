/**
 * Netlify Forms trigger: fires automatically on every verified form submission.
 *
 * Delivers the visitor's quiz result to their inbox via Brevo. Delivery is
 * optional-by-design: without BREVO_API_KEY the submission is still captured in
 * the Netlify dashboard, this function logs and exits cleanly, and nothing breaks.
 *
 * Required for delivery:  BREVO_API_KEY
 * Optional:               BREVO_LIST_ID  (also subscribes them to a mailing list)
 *                         EMAIL_FROM     (must be a verified Brevo sender)
 *                         EMAIL_FROM_NAME
 */

const FORM_NAME = "quiz-results";
const BREVO_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_CONTACTS_ENDPOINT = "https://api.brevo.com/v3/contacts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A direct POST can bypass the form's maxlength, so clamp on the server too.
const cleanName = (value) =>
  String(value ?? "").replace(/[<>\r\n]/g, "").trim().slice(0, 80);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The result field is newline-delimited: level, message, detail, patterns.
const resultToHtml = (result) =>
  String(result ?? "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 16px;line-height:1.7">${escapeHtml(block)}</p>`)
    .join("");

const buildEmail = ({ firstName, testName, result }) => {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#07091a;font-family:Georgia,'Times New Roman',serif;color:#f0eafa">
  <div style="max-width:560px;margin:0 auto;background:#0d1230;border:1px solid rgba(201,168,76,0.15);border-radius:16px;padding:32px">
    <p style="color:#c9a84c;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 20px">Embodying Sane</p>
    <p style="margin:0 0 16px;line-height:1.7">${greeting}</p>
    <p style="margin:0 0 24px;line-height:1.7">Here is your result from the ${escapeHtml(testName || "assessment")}.</p>
    <div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:24px;color:#d8d0ea">
      ${resultToHtml(result)}
    </div>
    <p style="margin:24px 0 0;line-height:1.7;color:#9d93b8;font-size:14px">
      This is a reflection tool, not a diagnosis. If you are in immediate danger, please contact your local emergency services.
    </p>
    <p style="margin:24px 0 0;color:#5f5678;font-size:12px">You received this because you asked for your result at embodysane.com.</p>
  </div>
</body></html>`;
};

export default async (req) => {
  let payload;
  try {
    ({ payload } = await req.json());
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (payload?.form_name !== FORM_NAME) {
    return new Response("Ignored", { status: 200 });
  }

  const data = payload.data || {};
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const firstName = cleanName(data.firstName);
  const testName = cleanName(data.testName);
  const resultLevel = cleanName(data.resultLevel);
  const result = data.result || "";

  if (!EMAIL_PATTERN.test(email)) {
    console.warn("quiz-results submission had no usable email address; nothing to send.");
    return new Response("OK", { status: 200 });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Captured in the Netlify dashboard, but no delivery configured yet.
    console.log(`Captured quiz-results submission for ${email}. Set BREVO_API_KEY to email results automatically.`);
    return new Response("OK", { status: 200 });
  }

  const headers = {
    "api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const sender = process.env.EMAIL_FROM || "hello@embodysane.com";
  if (!process.env.EMAIL_FROM) {
    console.warn(
      `EMAIL_FROM is not set; falling back to ${sender}. Brevo rejects sends from addresses that are not verified senders.`,
    );
  }

  try {
    const response = await fetch(BREVO_EMAIL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sender: {
          email: sender,
          name: process.env.EMAIL_FROM_NAME || "Embodying Sane",
        },
        to: [{ email, name: firstName || undefined }],
        subject: testName ? `Your ${testName} result` : "Your result",
        htmlContent: buildEmail({ firstName, testName, result }),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `Brevo email send failed (${response.status}). Check that BREVO_API_KEY is valid and that ${sender} is a verified sender in Brevo.`,
        detail,
      );
    }
  } catch (error) {
    console.error("Brevo email send threw.", error);
  }

  // Optional: subscribe them to an ongoing list.
  const listId = Number.parseInt(process.env.BREVO_LIST_ID ?? "", 10);
  if (Number.isFinite(listId)) {
    try {
      const response = await fetch(BREVO_CONTACTS_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          // These map to custom attributes you create in Brevo (Contacts > Settings >
          // Contact attributes). Missing ones are ignored rather than failing the call.
          attributes: {
            ...(firstName ? { FIRSTNAME: firstName } : {}),
            ...(testName ? { QUIZ_NAME: testName } : {}),
            ...(resultLevel ? { QUIZ_RESULT: resultLevel } : {}),
          },
          listIds: [listId],
          updateEnabled: true,
        }),
      });
      if (!response.ok) {
        console.error("Brevo contact upsert failed.", response.status, await response.text());
      }
    } catch (error) {
      console.error("Brevo contact upsert threw.", error);
    }
  }

  return new Response("OK", { status: 200 });
};
