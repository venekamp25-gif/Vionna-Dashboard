import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Listing Dashboard",
};

type Portal = {
  href: string;
  name: string;
  brand: string;
  markets: string;
  blurb: string;
  does: string[];
  /** Accent used for this card only — the portals read as different places. */
  tint: string;
  glow: string;
  icon: React.ReactNode;
  status?: string;
};

const PORTALS: Portal[] = [
  {
    href: "/fashion",
    name: "Fashion",
    brand: "Vionna",
    markets: "Denmark · France · Finland",
    blurb: "Women's fashion. Import a competitor product, generate the copy per market, publish to Shopify.",
    does: ["Research: what to list", "Import → copy → publish", "Size guides & Meta ads"],
    tint: "#10b981",
    glow: "rgba(16,185,129,0.35)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M9 3h6l3 4-3 2v12H9V9L6 7l3-4Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/home-decor",
    name: "Home Decor",
    brand: "The Light Supplier",
    markets: "Netherlands · Germany · International",
    blurb: "Lighting. Same idea as fashion, built around lamps: one product with its own variants — no colour duplicates.",
    does: ["Import → copy → publish", "Specs: wattage, bulb type, IP rating", "Research: what to list (next)"],
    tint: "#f59e0b",
    glow: "rgba(245,158,11,0.35)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.45.9 1.05.9 1.7V16h5.4v-.5c0-.65.3-1.25.9-1.7A6 6 0 0 0 12 3Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    status: "Being built",
  },
];

export default function PortalPicker() {
  return (
    <>
      <header className="h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 border-b border-border bg-bg-elev backdrop-blur">
        <Logo label="LISTING" sub="Dashboard" />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-8 py-16 lg:py-24">
        <div className="mb-10">
          <h1 className="text-[28px] font-bold tracking-tight text-text">Which portal?</h1>
          <p className="text-[14px] text-text-dim mt-2">
            Each portal has its own stores, its own product rules and its own copy. Pick the one you&apos;re
            listing for today — you can switch back here any time.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {PORTALS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group relative flex flex-col rounded-2xl border border-border bg-bg-elev p-7 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-3"
              style={{ ["--card-tint" as string]: p.tint, ["--card-glow" as string]: p.glow }}
            >
              {/* tint wash — only visible on hover, keeps the grid calm at rest */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{ background: "radial-gradient(120% 100% at 50% 0%, var(--card-glow), transparent 60%)", opacity: 0 }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-2xl"
                style={{ background: "var(--card-tint)" }}
              />

              <div className="relative flex items-start justify-between gap-3">
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-xl border"
                  style={{
                    color: "var(--card-tint)",
                    borderColor: "var(--card-tint)",
                    background: "color-mix(in srgb, var(--card-tint) 12%, transparent)",
                  }}
                >
                  {p.icon}
                </div>
                {p.status && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border border-border text-text-faint">
                    {p.status}
                  </span>
                )}
              </div>

              <h2 className="relative text-[20px] font-bold text-text mt-5 tracking-tight">{p.name}</h2>
              <p className="relative text-[12px] font-medium mt-0.5" style={{ color: "var(--card-tint)" }}>
                {p.brand}
              </p>
              <p className="relative text-[11.5px] text-text-faint mt-1">{p.markets}</p>

              <p className="relative text-[13px] text-text-dim leading-relaxed mt-4">{p.blurb}</p>

              <ul className="relative mt-4 space-y-1.5">
                {p.does.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-[12px] text-text-dim">
                    <span className="mt-[7px] w-1 h-1 rounded-full shrink-0" style={{ background: "var(--card-tint)" }} />
                    {d}
                  </li>
                ))}
              </ul>

              <span className="relative mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-text group-hover:gap-2.5 transition-all">
                Open {p.name}
                <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
