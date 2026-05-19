export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#0b0f14] text-[#eef2f7] font-sans">
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#10b981" />
              <stop offset="1" stopColor="#059669" />
            </linearGradient>
          </defs>
          <path d="M4 6 L16 26 L28 6" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="26" r="2.5" fill="url(#logoGrad)" />
        </svg>
        <h1 className="text-3xl font-bold tracking-[0.18em]">VIONNA</h1>
        <p className="text-sm text-[#94a3b8] uppercase tracking-[0.12em]">Product Dashboard · v2</p>
        <div className="mt-8 px-4 py-2 rounded-full bg-[#10b981]/10 border border-[#10b981]/30 text-xs text-[#10b981]">
          ✓ Next.js running on port 3000
        </div>
        <p className="mt-4 text-xs text-[#64748b] max-w-md">
          Phase 2 complete. UI will be ported from the legacy HTML dashboard in upcoming phases.
        </p>
      </div>
    </main>
  );
}
