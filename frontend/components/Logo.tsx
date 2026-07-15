/** Wordmark. `label` names the portal (FASHION / HOME DECOR); the mark paints
 *  with var(--accent) — NOT a hardcoded green — so a portal that re-skins the
 *  accent gets a matching mark instead of a stray fashion green. */
export function Logo({
  withText = true,
  size = 28,
  label = "FASHION",
  sub = "Listing Dashboard",
}: {
  withText?: boolean;
  size?: number;
  label?: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 group">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105"
        style={{ filter: "drop-shadow(0 0 8px var(--accent-glow))" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-hover)" />
          </linearGradient>
        </defs>
        <path d="M4 6 L16 26 L28 6" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="26" r="2.5" fill="url(#logoGrad)" />
      </svg>
      {withText && (
        <div className="flex flex-col leading-none">
          <span className="text-[16px] font-bold tracking-[0.18em] text-text">{label}</span>
          <span className="text-[10px] font-medium tracking-[0.12em] text-text-faint uppercase mt-[3px]">
            {sub}
          </span>
        </div>
      )}
    </div>
  );
}
