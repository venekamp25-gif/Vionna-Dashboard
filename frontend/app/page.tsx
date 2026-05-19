"use client";

import { Header } from "@/components/Header";
import { Steps } from "@/components/Steps";
import { InputStep } from "@/components/steps/InputStep";
import { GenerateStep } from "@/components/steps/GenerateStep";
import { ReviewStep } from "@/components/steps/ReviewStep";
import { PublishStep } from "@/components/steps/PublishStep";
import { useStep } from "@/lib/step";

export default function Home() {
  const { step } = useStep();

  return (
    <>
      <Header />
      <Steps />
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-8 py-8">
        {step === 1 && <InputStep />}
        {step === 2 && <GenerateStep />}
        {step === 3 && <ReviewStep />}
        {step === 4 && <PublishStep />}
      </main>
    </>
  );
}
