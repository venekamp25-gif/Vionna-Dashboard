import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession, createDropletToken } from "@/lib/auth";

/**
 * Mint a short-lived token the logged-in user's browser sends to the Python
 * droplet's mutation endpoints (publish / backfill). The browser calls the
 * droplet DIRECTLY with this token (no Netlify-function timeout on slow image
 * uploads), while DROPLET_TOKEN_SECRET stays server-side and never ships in the
 * client bundle. Only authenticated users get a token.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const dropletToken = await createDropletToken(session.email);
  return NextResponse.json({ token: dropletToken });
}
