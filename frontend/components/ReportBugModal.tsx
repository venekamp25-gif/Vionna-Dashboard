"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, fetchCurrentUser } from "@/lib/api";
import { useStore } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal where employees describe a bug they hit. Submission queues the
 * report on the droplet (jsonl + screenshot folder); Claude Code picks the
 * queue up at the start of the CEO's next session.
 *
 * Designed for non-technical reporters — three required fields, one
 * optional screenshot upload, clear examples, instant success / failure
 * feedback.
 */
export function ReportBugModal({ open, onClose }: Props) {
  const { store } = useStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporterEmail, setReporterEmail] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the modal re-opens + try to figure out who's reporting
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setScreenshot(null);
    setScreenshotName("");
    setSubmitted(null);
    setError(null);
    void fetchCurrentUser().then((u) => setReporterEmail(u.email ?? ""));
  }, [open]);

  if (!open) return null;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 5 MB cap matches the backend
    if (file.size > 5 * 1024 * 1024) {
      setError("Screenshot too large (max 5 MB). Crop it and try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshot((reader.result as string) ?? null);
      setScreenshotName(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      setError("Title and 'What happened' are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.reportBug({
        title:           title.trim(),
        description:     description.trim(),
        page_url:        typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
        reporter_email:  reporterEmail || undefined,
        store,
        screenshot:      screenshot ?? undefined,
      });
      if (!res.success || res.error) throw new Error(res.error ?? "Unknown error");
      setSubmitted(res.id ?? 0);
      // Fire a Slack notification (best-effort — never blocks the success UI).
      void fetch("/api/notify-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: res.id,
          title: title.trim(),
          description: description.trim(),
          reporter_email: reporterEmail || undefined,
          store,
          page_url:
            typeof window !== "undefined"
              ? window.location.pathname + window.location.search
              : "",
          has_screenshot: !!screenshot,
        }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">🐛 Report a bug</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              Sent straight to the dev queue. You don&apos;t need to explain in
              full detail — a clear title + screenshot is usually enough.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-xl px-2"
          >
            ✕
          </button>
        </div>

        {submitted !== null ? (
          // Success view
          <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent/20 text-accent text-2xl flex items-center justify-center">
              ✓
            </div>
            <h3 className="text-[15px] font-semibold text-text">
              Bug #{submitted} sent
            </h3>
            <p className="text-[12px] text-text-faint max-w-sm leading-relaxed">
              Thanks — it&apos;s in the queue. The developer will see it on their
              next session. If it&apos;s urgent, ping your manager directly too.
            </p>
            <Button variant="primary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              {/* Title */}
              <div>
                <label className="block mb-1.5">
                  <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
                    Title *
                  </span>
                  <span className="ml-2 text-[11px] font-normal text-text-faint">
                    (one sentence)
                  </span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder='e.g. "Sizes are showing as colors when I import Meshki product"'
                  maxLength={200}
                  className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block mb-1.5">
                  <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
                    What happened? *
                  </span>
                  <span className="ml-2 text-[11px] font-normal text-text-faint">
                    (the more specific, the faster it gets fixed)
                  </span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What were you doing, what did you expect, what happened instead? Include the competitor URL if relevant."
                  rows={6}
                  maxLength={5000}
                  className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)] resize-y leading-relaxed"
                />
                <div className="text-[10px] text-text-faint mt-1 text-right">
                  {description.length} / 5000
                </div>
              </div>

              {/* Screenshot */}
              <div>
                <label className="block mb-1.5">
                  <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
                    Screenshot
                  </span>
                  <span className="ml-2 text-[11px] font-normal text-text-faint">
                    (optional, but really helpful — max 5 MB)
                  </span>
                </label>
                {screenshot ? (
                  <div className="flex items-center gap-3 p-2 rounded-[10px] border border-border bg-bg-elev-2">
                    <img
                      src={screenshot}
                      alt="Screenshot preview"
                      className="w-16 h-16 object-cover rounded-md border border-border"
                    />
                    <div className="flex-1 text-[12px] text-text-dim truncate">
                      {screenshotName}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshot(null);
                        setScreenshotName("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="text-[11px] text-text-faint hover:text-danger px-2"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="bug-screenshot"
                    className="flex items-center justify-center gap-2 px-3.5 py-3 rounded-[10px] border border-dashed border-border bg-bg-elev-2/50 text-[12px] text-text-faint cursor-pointer hover:border-accent hover:text-accent transition-colors"
                  >
                    📎 Click to attach a screenshot
                  </label>
                )}
                <input
                  ref={fileInputRef}
                  id="bug-screenshot"
                  type="file"
                  accept="image/*"
                  onChange={onFile}
                  className="hidden"
                />
              </div>

              {/* Context */}
              <div className="text-[11px] text-text-faint border-t border-border pt-3 leading-relaxed">
                <strong className="text-text-dim">Automatically included:</strong>{" "}
                your email ({reporterEmail || "(not logged in)"}), the active
                store ({store.toUpperCase()}), and the page you were on. No
                need to retype any of that.
              </div>

              {error && (
                <div className="text-[12px] text-danger px-3.5 py-2 rounded-[10px] bg-danger/10 border border-danger/30">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={submitting || !title.trim() || !description.trim()}
              >
                {submitting ? "Sending…" : "Send report →"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
