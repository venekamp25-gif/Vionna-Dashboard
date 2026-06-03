/**
 * Auth helpers — JWT-based sessions with 7-day expiry, signed with AUTH_SECRET.
 * Credentials live in env vars (AUTH_EMAIL + AUTH_PASSWORD). For a single user
 * setup this is fine; switch to a database when there's more than one user.
 */
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-only-secret-change-in-prod-please-and-thanks-32-chars"
);
const SESSION_DURATION_SEC = 7 * 24 * 60 * 60;   // 7 days

// Separate secret for the short-lived tokens the browser sends to the Python
// droplet on mutation calls (publish / backfill). Signed here on the server so
// the secret never reaches the browser; the droplet verifies it with the SAME
// DROPLET_TOKEN_SECRET. Kept distinct from AUTH_SECRET so a leak of one doesn't
// compromise the other.
const DROPLET_TOKEN_SECRET = new TextEncoder().encode(
  process.env.DROPLET_TOKEN_SECRET || "dev-only-droplet-secret-change-in-prod-please-32-chars-min"
);
const DROPLET_TOKEN_DURATION_SEC = 5 * 60;       // 5 minutes — long enough for one publish run

export const COOKIE_NAME = "vionna_session";

export interface SessionPayload {
  email: string;
  iat?: number;
  exp?: number;
}

export async function createSession(email: string): Promise<string> {
  return await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SEC}s`)
    .sign(SECRET);
}

/**
 * Mint a short-lived token the browser sends to the Python droplet on mutation
 * calls. Standard HS256 JWT so the droplet can verify it with stdlib (no PyJWT).
 */
export async function createDropletToken(email: string): Promise<string> {
  return await new SignJWT({ email, scope: "mutations" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DROPLET_TOKEN_DURATION_SEC}s`)
    .sign(DROPLET_TOKEN_SECRET);
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.email !== "string") return null;
    return {
      email: payload.email,
      iat:   typeof payload.iat === "number" ? payload.iat : undefined,
      exp:   typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Check credentials against env vars.
 * Supports up to 5 user accounts using suffix-based env vars:
 *   - AUTH_EMAIL   + AUTH_PASSWORD     (user 1)
 *   - AUTH_EMAIL_2 + AUTH_PASSWORD_2   (user 2)
 *   - AUTH_EMAIL_3 + AUTH_PASSWORD_3   (user 3)
 *   - …up to _5
 * Add a new pair in Netlify env vars to give someone access; remove to revoke.
 */
export function checkCredentials(email: string, password: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase();
  const inputEmail = normalize(email);

  const suffixes = ["", "_2", "_3", "_4", "_5"];
  for (const suffix of suffixes) {
    const expectedEmail = process.env[`AUTH_EMAIL${suffix}`] || "";
    const expectedPassword = process.env[`AUTH_PASSWORD${suffix}`] || "";
    if (!expectedEmail || !expectedPassword) continue;
    if (normalize(expectedEmail) === inputEmail && password === expectedPassword) {
      return true;
    }
  }
  return false;
}

export const SESSION_MAX_AGE = SESSION_DURATION_SEC;
