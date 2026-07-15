"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme";
import { StoreProvider } from "@/lib/store";
import { StepProvider } from "@/lib/step";
import { ProductProvider } from "@/lib/product";

/** App-wide providers — mounted at the root for every page (portal picker, both
 *  portals, login). Only genuinely global state belongs here. */
export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

/** Fashion-wizard state (market toggle, step, draft product). Scoped to the
 *  /fashion route group — the picker and the Home Decor portal must NOT mount
 *  these: ProductProvider seeds a FASHION draft (sizes XS-XL, productType
 *  'dress') and StoreProvider defaults to the DK market. */
export function FashionProviders({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <StepProvider>
        <ProductProvider>{children}</ProductProvider>
      </StepProvider>
    </StoreProvider>
  );
}
