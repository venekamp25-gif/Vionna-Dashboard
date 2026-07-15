import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Home Decor · Listing Dashboard",
};

const SOON: { title: string; body: string; state: "building" | "next" }[] = [
  {
    title: "Import → copy → publish",
    body: "Paste a competitor's lamp URL, get Dutch/German/English copy, publish to The Light Supplier. One product with its own variants — no colour duplicates like Vionna.",
    state: "building",
  },
  {
    title: "Lighting specs instead of size charts",
    body: "Wattage, bulb type and cap (E27/GU10), light temperature, mounting type, IP rating — the fields Shopify and Google actually expect for lighting.",
    state: "building",
  },
  {
    title: "Research: what to list",
    body: "The same funnel as fashion — product types by season, competitor stores by local traffic, their bestsellers — retuned for lighting.",
    state: "next",
  },
];

export default function HomeDecorPortal() {
  return (
    <div style={{ ["--accent" as string]: "#f59e0b", ["--accent-hover" as string]: "#d97706", ["--accent-glow" as string]: "rgba(245,158,11,0.35)" }}>
      <header className="h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 border-b border-border bg-bg-elev backdrop-blur">
        <div className="flex items-center gap-5">
          <Logo label="HOME DECOR" sub="Listing Dashboard" />
          <Link href="/" className="text-[12px] text-text-faint hover:text-text transition-colors">
            ← All portals
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-8 py-16">
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border border-border text-text-faint">
          Being built
        </span>
        <h1 className="text-[28px] font-bold tracking-tight text-text mt-4">The lighting portal is on its way</h1>
        <p className="text-[14px] text-text-dim mt-2 leading-relaxed">
          It mirrors the fashion flow, but it is built around how lamps actually work — so it is a separate
          flow, not a copy. Nothing here touches the Vionna stores.
        </p>

        <div className="mt-8 space-y-3">
          {SOON.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border bg-bg-elev p-5">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[14px] font-semibold text-text">{s.title}</h2>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    s.state === "building"
                      ? "text-accent border border-accent/40 bg-accent/10"
                      : "text-text-faint border border-border"
                  }`}
                >
                  {s.state === "building" ? "Building now" : "Next"}
                </span>
              </div>
              <p className="text-[12.5px] text-text-dim leading-relaxed mt-1.5">{s.body}</p>
            </div>
          ))}
        </div>

        <p className="text-[12px] text-text-faint mt-8">
          Listing fashion in the meantime?{" "}
          <Link href="/fashion" className="text-accent hover:underline">
            Open the Fashion portal →
          </Link>
        </p>
      </main>
    </div>
  );
}
