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

/** Check credentials against env vars. */
export function checkCredentials(email: string, password: string): boolean {
  const expectedEmail = process.env.AUTH_EMAIL || "";
  const expectedPassword = process.env.AUTH_PASSWORD || "";
  if (!expectedEmail || !expectedPassword) return false;
  return (
    email.trim().toLowerCase() === expectedEmail.trim().toLowerCase() &&
    password === expectedPassword
  );
}

export const SESSION_MAX_AGE = SESSION_DURATION_SEC;
