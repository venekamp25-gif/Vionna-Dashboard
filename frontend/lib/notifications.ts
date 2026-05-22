"use client";

/**
 * Thin wrapper around the browser Notification API.
 *
 * We ask for permission lazily — the FIRST time a generation kicks off in
 * an active session, we silently call requestNotificationPermission(). The
 * prompt only ever fires once per browser; subsequent generations either
 * notify (granted) or are no-ops (denied / default-without-asking).
 *
 * Notifications themselves are best-effort: we never throw on a missing API
 * or a denied permission, so callers can fire-and-forget.
 */

const ICON_URL = "/favicon.ico";

/** True if the browser supports notifications AND the page is in a context
 *  where they're useful (server-side and SSR pre-hydration get filtered). */
export function notificationsAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Current permission state, or `"unsupported"` if the API isn't present. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsAvailable()) return "unsupported";
  return Notification.permission;
}

/**
 * Ask the user for notification permission if we haven't yet.
 *
 * Browsers require this to be called from a user-initiated event handler
 * (click / keypress). Call this on the first NB generate click so the prompt
 * lines up with the user's intent (they expect to wait for something).
 *
 * Returns the final permission after the user answered (or the existing one
 * if already decided). Silent no-op when unsupported.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsAvailable()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Fire a desktop notification. Best-effort: silent when permission is denied
 * or the API is missing. The `tag` lets later notifications replace earlier
 * ones with the same key (so we don't spam if the same step finishes twice
 * after a regenerate).
 */
export function notify(title: string, body: string, tag?: string): void {
  if (!notificationsAvailable()) return;
  if (Notification.permission !== "granted") return;
  // Don't bother showing one if the user is already looking at the page.
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(title, {
      body,
      icon: ICON_URL,
      tag,
      // Don't make a sound — most users have multiple tabs open and prefer silence.
      silent: true,
    });
    // Bring the tab forward on click
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      n.close();
    };
    // Auto-close after 8s so they don't pile up on the OS
    setTimeout(() => {
      try { n.close(); } catch {}
    }, 8000);
  } catch {
    // Some browsers throw on certain options — give up silently
  }
}
