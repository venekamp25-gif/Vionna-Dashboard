import { NextRequest, NextResponse } from "next/server";

/**
 * Posts a new bug report to Slack via an Incoming Webhook.
 *
 * The webhook URL is read from the SLACK_BUG_WEBHOOK env var (set in the
 * Netlify dashboard — never committed, since the repo is public). If it's
 * not set, this route is a silent no-op so bug submission still works.
 *
 * Called best-effort from ReportBugModal right after a bug is saved to the
 * droplet. The Slack message links back to the screenshot served by the
 * Python backend so the CEO can triage from their phone.
 */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ||
  "https://188-166-11-177.nip.io";

export async function POST(req: NextRequest) {
  const webhook = process.env.SLACK_BUG_WEBHOOK;
  if (!webhook) {
    // Not configured — succeed quietly so the bug flow isn't affected.
    return NextResponse.json({ ok: true, slack: "not-configured" });
  }

  let body: {
    id?: number;
    title?: string;
    description?: string;
    reporter_email?: string;
    store?: string;
    page_url?: string;
    has_screenshot?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }

  const id = body.id ?? "?";
  const title = (body.title || "(no title)").slice(0, 200);
  const desc = (body.description || "").slice(0, 600);
  const reporter = body.reporter_email || "unknown";
  const store = (body.store || "").toUpperCase();
  const page = body.page_url || "";
  const screenshotUrl = body.has_screenshot
    ? `${BACKEND_URL}/api/bug_reports/${id}/screenshot`
    : null;

  // Slack Block Kit message — readable on desktop + mobile.
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🐛 New bug #${id}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Reporter:*\n${reporter}` },
        { type: "mrkdwn", text: `*Store:*\n${store || "—"}` },
        { type: "mrkdwn", text: `*Page:*\n${page || "—"}` },
        { type: "mrkdwn", text: `*ID:*\n#${id}` },
      ],
    },
  ];
  if (desc) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `>${desc.replace(/\n/g, "\n>")}` },
    });
  }
  if (screenshotUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<${screenshotUrl}|📎 View screenshot>` },
      accessory: {
        type: "image",
        image_url: screenshotUrl,
        alt_text: "screenshot",
      },
    });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Open Claude Code and say *“work the bug queue”* to fix.",
      },
    ],
  });

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🐛 New bug #${id}: ${title}`, // fallback / notification text
        blocks,
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `slack ${res.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
