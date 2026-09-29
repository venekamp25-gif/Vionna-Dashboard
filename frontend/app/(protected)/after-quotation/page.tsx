import type { Metadata } from "next";
import { AfterQuotationWorkbench } from "@/components/after-quotation/AfterQuotationWorkbench";

export const metadata: Metadata = {
  title: "After quotation · Vionna",
};

/** Full-screen tool — opened in its own browser tab from the fashion Tools
 *  menu, inside the (protected) group so it shares the login gate. */
export default function AfterQuotationPage() {
  return <AfterQuotationWorkbench />;
}
