import { admin } from "@netlify/identity";

/** Every Identity user, across pages. Fine at this site's scale. */
export async function listAllIdentityUsers() {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const batch = await admin.listUsers({ page, perPage: 100 });
    users.push(...batch);
    if (batch.length < 100) break;
  }
  return users;
}

export async function findIdentityUserByEmail(email) {
  const target = email.trim().toLowerCase();
  const users = await listAllIdentityUsers();
  return users.find((user) => user.email?.toLowerCase() === target) ?? null;
}
