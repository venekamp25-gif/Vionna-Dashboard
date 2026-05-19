"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme";
import { StoreProvider } from "@/lib/store";
import { StepProvider } from "@/lib/step";
import { ProductProvider } from "@/lib/product";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <StoreProvider>
        <StepProvider>
          <ProductProvider>{children}</ProductProvider>
        </StepProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
