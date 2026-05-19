import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, COOKIE_NAME } from "@/lib/auth";

/**
 * Server-side auth gate.
 * Routes inside the `(protected)` group require a valid session cookie.
 * Replaces the Edge middleware (which Netlify functions-origin was choking on).
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (!session) {
    redirect("/login");
  }

  return <>{children}</>;
}
