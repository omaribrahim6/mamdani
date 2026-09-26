import { createSign } from 'node:crypto';

// Google Cloud credentials for the server: the Vertex AI express key for Gemini calls, and a
// service account (OAuth access tokens) for the Vertex APIs keys can't reach — embeddings,
// Live, and Check Grounding. The service account JSON arrives base64-encoded in one env var.

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

let sa: ServiceAccount | null | undefined;
export function serviceAccount(): ServiceAccount | null {
  if (sa !== undefined) return sa;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  sa = b64 ? (JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as ServiceAccount) : null;
  return sa;
}

export const project = () => process.env.GCP_PROJECT_ID || serviceAccount()?.project_id || '';
export const location = () => process.env.GCP_LOCATION || 'global';
export const vertexKey = () => process.env.VERTEX_EXPRESS_KEY || '';
export const hasVertex = () => !!vertexKey() || !!serviceAccount();

let cached: { token: string; expires: number } | null = null;

/** A cloud-platform OAuth access token for the service account (cached until near expiry). */
export async function accessToken(): Promise<string | null> {
  const acct = serviceAccount();
  if (!acct) return null;
  if (cached && cached.expires - Date.now() > 120_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: acct.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: acct.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(acct.private_key).toString('base64url');
  const r = await fetch(acct.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`service account token: ${j.error_description ?? r.status}`);
  cached = { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}
