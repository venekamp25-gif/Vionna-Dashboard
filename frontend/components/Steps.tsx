"use client";

import { useStep, STEPS } from "@/lib/step";

export function Steps() {
  const { step: current } = useStep();

  return (
    <nav className="flex items-center justify-center gap-0 py-4 bg-bg" aria-label="Workflow progress">
      {STEPS.map((s, i) => {
        const isActive = s.n === current;
        const isDone   = s.n < current;
        return (
          <div key={s.n} className="flex items-center">
            {i > 0 && (
              <div
                className="w-6 h-0.5 transition-colors duration-300"
                style={{ background: s.n <= current ? "var(--accent)" : "var(--border)" }}
              />
            )}
            <div
              className={[
                "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 text-sm font-semibold",
                isActive && "bg-accent text-on-accent shadow-[0_4px_16px_var(--accent-glow)]",
                isDone   && "text-text-dim",
                !isActive && !isDone && "text-text-faint",
              ].filter(Boolean).join(" ")}
            >
              <span
                className={[
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                  isActive ? "bg-bg text-accent" : isDone ? "bg-accent text-on-accent" : "bg-bg-elev-2 text-text-dim",
                ].join(" ")}
              >
                {s.n}
              </span>
              <span className="uppercase tracking-wider">{s.label}</span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
