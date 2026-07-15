import type { Metadata } from "next";
import { LightProductProvider } from "@/lib/lightProduct";

export const metadata: Metadata = {
  title: "Home Decor · Listing Dashboard",
};

/** Home Decor's own draft state. Deliberately NOT the fashion ProductProvider:
 *  that one seeds sizes XS-XL, productType 'dress' and the DK market — none of
 *  which mean anything for a lamp. */
export default function HomeDecorLayout({ children }: { children: React.ReactNode }) {
  return <LightProductProvider>{children}</LightProductProvider>;
}
