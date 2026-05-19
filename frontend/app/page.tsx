"use client";

import { Header } from "@/components/Header";
import { Steps } from "@/components/Steps";
import { InputStep } from "@/components/steps/InputStep";
import { GenerateStep } from "@/components/steps/GenerateStep";
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
        {step === 1 && <InputStep />}
        {step === 2 && <GenerateStep />}

        {step >= 3 && (
          <div className="bg-bg-elev border border-border rounded-2xl p-8 max-w-3xl mx-auto">
            <h2 className="text-lg font-semibold mb-2">Step {step}: coming next</h2>
            <p className="text-text-dim text-sm mb-6">
              Current store: <strong className="text-text">{store.toUpperCase()}</strong>. This step will be built in
              the next substep (3d).
            </p>
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg bg-bg-elev-2 border border-border text-sm hover:border-accent hover:text-accent transition"
            >
              ← Back to Input
            </button>
          </div>
        )}
      </main>
    </>
  );
}
