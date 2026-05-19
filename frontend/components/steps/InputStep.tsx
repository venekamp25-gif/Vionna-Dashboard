"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Label, Input, Textarea } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStep } from "@/lib/step";

export function InputStep() {
  const { data, patch } = useProduct();
  const { setStep } = useStep();

  const canSubmit = data.competitorUrl.trim().length > 0;

  const onSubmit = () => {
    if (!canSubmit) return;
    // Parse keywords into array for downstream steps
    const parsedKeywords = data.keywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    patch({ parsedKeywords });
    setStep(2);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Card title="Competitor product">
        <Field>
          <Label>Competitor URL</Label>
          <Input
            type="text"
            value={data.competitorUrl}
            onChange={(e) => patch({ competitorUrl: e.target.value })}
            placeholder="Paste competitor product URL here..."
          />
        </Field>

        <Field>
          <Label hint="(one per line, from Ubersuggest/Trends sheet)">Keywords</Label>
          <Textarea
            rows={6}
            value={data.keywords}
            onChange={(e) => patch({ keywords: e.target.value })}
            placeholder={
              "Put keywords researched for this product here...\n(one per line, e.g. from Ubersuggest or Google Trends)"
            }
          />
        </Field>

        <Button onClick={onSubmit} disabled={!canSubmit}>
          Import &amp; Generate →
        </Button>
      </Card>
    </div>
  );
}
