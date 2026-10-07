/**
 * Netlify Forms trigger: fires automatically on every verified form submission.
 *
 * For the "quiz-results" form it saves the visitor to email_contacts (visible
 * on /admin), emails them their result through the shared Brevo sender, adds
 * them to the Brevo mailing list, and alerts the owner. The submission also
 * stays in the Netlify Forms dashboard as a backup.
 */
import { upsertContact } from "../../db/email.js";
import { addToMailingList, emailLayout, escapeHtml, notifyOwner, sendEmail } from "../../lib/email.mjs";

const FORM_NAME = "quiz-results";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A direct POST can bypass the form's maxlength, so clamp on the server too.
const cleanName = (value) =>
  String(value ?? "").replace(/[<>\r\n]/g, "").trim().slice(0, 80);

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
  return emailLayout(
    `<p style="margin:0 0 16px;line-height:1.7">${greeting}</p>
    <p style="margin:0 0 24px;line-height:1.7">Here is your result from the ${escapeHtml(testName || "assessment")}.</p>
    <div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:24px;color:#d8d0ea">
      ${resultToHtml(result)}
    </div>
    <p style="margin:24px 0 0;line-height:1.7;color:#9d93b8;font-size:14px">
      This is a reflection tool, not a diagnosis. If you are in immediate danger, please contact your local emergency services.
    </p>`,
    "You received this because you asked for your result at embodysane.com.",
  );
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
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const firstName = cleanName(data.firstName);
  const testName = cleanName(data.testName);
  const resultLevel = cleanName(data.resultLevel);
  const result = String(data.result || "").slice(0, 5000);

  if (!EMAIL_PATTERN.test(email)) {
    console.warn("quiz-results submission had no usable email address; nothing to send.");
    return new Response("OK", { status: 200 });
  }

  try {
    const { isNew } = await upsertContact({ email, firstName, quizName: testName || "Quiz", quizResult: resultLevel });
    await sendEmail({
      kind: "quiz-result",
      to: email,
      toName: firstName || undefined,
      subject: testName ? `Your ${testName} result` : "Your result",
      html: buildEmail({ firstName, testName, result }),
    });
    await addToMailingList(email, {
      ...(firstName ? { FIRSTNAME: firstName } : {}),
      ...(testName ? { QUIZ_NAME: testName } : {}),
      ...(resultLevel ? { QUIZ_RESULT: resultLevel } : {}),
    });
    await notifyOwner(isNew ? "New quiz signup" : "Returning quiz taker", [
      `Email: ${email}${firstName ? ` (${firstName})` : ""}`,
      `Quiz: ${testName || "Unknown"}${resultLevel ? `, result: ${resultLevel}` : ""}`,
    ]);
  } catch (error) {
    console.error("quiz-results processing failed.", error);
  }

  return new Response("OK", { status: 200 });
};
