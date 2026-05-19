"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { useStep } from "@/lib/step";
import { useProduct } from "@/lib/product";

const FAKE_STEPS = [
  { main: "Fetching competitor product…",       sub: "Scraping product details" },
  { main: "Generating product name…",           sub: "Checking uniqueness in catalog" },
  { main: "Generating description via Claude…", sub: "Style: calm, practical, comfort-oriented" },
  { main: "Preparing review…",                  sub: "Almost there" },
];

export function GenerateStep() {
  const { setStep } = useStep();
  const { data, patch } = useProduct();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= FAKE_STEPS.length) {
      // Populate mock data so Review step shows something meaningful
      patch({
        competitor: {
          title: "The Dakota Maxi Dress in Cream & Black",
          hostname: data.competitorUrl ? new URL(data.competitorUrl).hostname.replace(/^www\./, "") : "rosamae.co.uk",
          variants: 7,
          price: "€510.00",
        },
        name: data.name || "Freya",
        colors: data.colors.length ? data.colors : ["Blå"],
        cutline: "Blå",
        siblingsHandle: "freya-siblings",
        description:
          "Luftig og let at have på\n\nFreya er en let linnen sommerkjole med en afslappet pasform og brede stropper. Det naturlige linnen-materiale holder dig kølig på varme dage og giver et luftigt, ubesværet look.\n\n• Linnen-blanding: åndbart og let materiale til varme dage\n• Løst snit: sidder afslappet og giver god bevægelighed\n• Brede stropper: komfortabel pasform hele dagen\n• Lommer i siden: praktisk detalje\n• Enkel søm: roligt look der er nemt at style\n\nFreya er en kjole, der er nem at tage på, og som føles behagelig fra morgen til aften.",
        metaDescription:
          "Køb Freya linnen sommerkjole. Luftig og komfortabel kjole til varme dage — nem at kombinere.",
        mTitleSpecs: "Luftig linnen sommerkjole med lommer og løst snit",
        parsedKeywords: data.parsedKeywords.length
          ? data.parsedKeywords
          : ["linnen kjole", "sommerkjole", "casual kjole", "strandkjole", "boheme kjole"],
      });
      const t = setTimeout(() => setStep(3), 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIdx((i) => i + 1), 1500);
    return () => clearTimeout(t);
  }, [idx, setStep, patch, data]);

  const currentLabel = FAKE_STEPS[Math.min(idx, FAKE_STEPS.length - 1)];

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-bg-elev border border-border rounded-2xl px-8 py-16 flex flex-col items-center gap-6 text-center shadow-md">
        <Spinner size={48} />
        <div className="flex flex-col gap-2 min-h-[58px]">
          <p className="text-sm font-medium text-text">{currentLabel.main}</p>
          <p className="text-xs text-text-faint">{currentLabel.sub}</p>
        </div>
        <div className="w-full max-w-xs mt-2">
          <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-700 ease-out"
              style={{ width: `${Math.min((idx / FAKE_STEPS.length) * 100, 100)}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
          ✕ Cancel
        </Button>
      </div>
      <p className="text-[11px] text-text-faint text-center mt-3">
        Demo mode — real progress will be wired up in Phase 4 (API integration).
      </p>
    </div>
  );
}
