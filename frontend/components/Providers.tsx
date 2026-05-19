"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme";
import { StoreProvider } from "@/lib/store";
import { StepProvider } from "@/lib/step";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <StoreProvider>
        <StepProvider>{children}</StepProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
