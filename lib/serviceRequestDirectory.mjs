// The existing first page supports the admin directory. Resolve only missing
// identities referenced by the authorised request rows, in bounded batches.
export async function resolveServiceRequestUsers(admin, rows) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = [...(data?.users || [])];
  const known = new Set(users.map((user) => user.id));
  const missing = [...new Set((rows || []).flatMap((row) => [row.created_by, row.reviewed_by]).filter((id) => id && !known.has(id)))];
  for (let index = 0; index < missing.length; index += 10) {
    const batch = await Promise.all(missing.slice(index, index + 10).map(async (id) => {
      try {
        const result = await admin.auth.admin.getUserById(id);
        return result.data?.user || null;
      } catch {
        return null;
      }
    }));
    users.push(...batch.filter(Boolean));
  }
  return users;
}

export function serviceRequestUserName(user) {
  const metadata = user?.user_metadata || {};
  const parts = [metadata.first_name || metadata.firstName, metadata.last_name || metadata.lastName].filter(Boolean).join(" ");
  return metadata.full_name || metadata.name || parts || user?.email || "";
}
