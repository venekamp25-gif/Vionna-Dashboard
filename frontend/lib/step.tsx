"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type Step = 1 | 2 | 3 | 4;
export const STEPS = [
  { n: 1, label: "Input" },
  { n: 2, label: "Generate" },
  { n: 3, label: "Review" },
  { n: 4, label: "Publish" },
] as const;

const StepContext = createContext<{ step: Step; setStep: (s: Step) => void }>({
  step: 1,
  setStep: () => {},
});

export function StepProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>(1);
  return (
    <StepContext.Provider value={{ step, setStep }}>
      {children}
    </StepContext.Provider>
  );
}

export const useStep = () => useContext(StepContext);
