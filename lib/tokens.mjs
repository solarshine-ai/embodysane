import crypto from "node:crypto";

/** Sign-in tokens are stored hashed, so the database never holds a usable link. */
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
