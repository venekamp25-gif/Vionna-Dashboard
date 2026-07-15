import type { Metadata } from "next";
import { FashionProviders } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Fashion · Listing Dashboard",
};

/** The fashion wizard's state lives here, not at the root — so the portal
 *  picker and the Home Decor portal don't mount a fashion draft (sizes XS-XL,
 *  productType 'dress') or default to the DK market. */
export default function FashionLayout({ children }: { children: React.ReactNode }) {
  return <FashionProviders>{children}</FashionProviders>;
}
