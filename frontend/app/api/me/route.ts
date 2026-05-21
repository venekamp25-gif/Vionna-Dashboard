import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

/**
 * Return the currently-logged-in user's email by decoding the JWT session cookie.
 * Used by the frontend to scope server-side drafts per employee.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ email: null }, { status: 401 });
  }
  return NextResponse.json({ email: session.email });
}
