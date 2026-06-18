"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-bg-elev border border-border rounded-2xl p-8 shadow-lg"
      >
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <h1 className="text-[18px] font-bold text-text text-center mb-1">Sign in</h1>
        <p className="text-[12px] text-text-faint text-center mb-6">
          Internal dashboard — staff only.
        </p>

        <div className="mb-4">
          <label className="block text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint transition-all duration-150 hover:border-border-hover focus:outline-none focus:border-accent focus:bg-bg-elev focus:ring-3 focus:ring-[var(--accent-soft)]"
          />
        </div>

        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint transition-all duration-150 hover:border-border-hover focus:outline-none focus:border-accent focus:bg-bg-elev focus:ring-3 focus:ring-[var(--accent-soft)]"
          />
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-md bg-danger/15 border border-danger/40 text-danger text-[12px]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] bg-accent text-on-accent shadow-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.98]"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-[10px] text-text-faint text-center mt-6">
          Sessions stay active for 7 days.
        </p>
      </form>
    </main>
  );
}
