/**
 * Who owns this site. The owner gets the admin page at /admin and the alert
 * emails. OWNER_EMAIL may list several addresses separated by commas.
 */
const DEFAULT_OWNER = "solarandshine8@gmail.com";

export const ownerEmails = () =>
  (Netlify.env.get("OWNER_EMAIL") || DEFAULT_OWNER)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const isOwner = (user) =>
  Boolean(user?.email) && ownerEmails().includes(user.email.trim().toLowerCase());
