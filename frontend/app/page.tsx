"use client";

import { Header } from "@/components/Header";
import { Steps } from "@/components/Steps";
import { useStep } from "@/lib/step";
import { useStore } from "@/lib/store";

export default function Home() {
  const { step, setStep } = useStep();
  const { store } = useStore();

  return (
    <>
      <Header />
      <Steps />
      <main className="flex-1 max-w-7xl w-full mx-auto px-8 py-8">
        <div className="bg-bg-elev border border-border rounded-2xl p-8">
          <h2 className="text-lg font-semibold mb-2">Step {step}: Placeholder</h2>
          <p className="text-text-dim text-sm mb-6">
            Current store: <strong className="text-text">{store.toUpperCase()}</strong>. The real UI will be ported in
            upcoming substeps (3b → 3g). For now, you can click the buttons below to test the step navigation,
            store switcher and theme toggle.
          </p>
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setStep(n as 1 | 2 | 3 | 4)}
                className="px-4 py-2 rounded-lg bg-bg-elev-2 border border-border text-sm hover:border-accent hover:text-accent transition"
              >
                Go to step {n}
              </button>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
