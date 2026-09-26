// Tiger Cloud URLs carry `sslmode=require`, which node-postgres now treats as full certificate
// verification. We strip it and configure TLS explicitly instead.
export function pgConfig(url = process.env.DATABASE_URL ?? '') {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  return { connectionString: u.toString(), ssl: local ? undefined : { rejectUnauthorized: false } };
}
