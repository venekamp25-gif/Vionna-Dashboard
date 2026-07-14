import type { Metadata } from "next";
import { WhatToListWorkbench } from "@/components/research/WhatToListWorkbench";

export const metadata: Metadata = {
  title: "Product research · What to list",
};

/** Full-screen research workbench — opened in its own browser tab from the
 *  Tools menu, inside the (protected) group so it shares the login gate. */
export default function ResearchPage() {
  return <WhatToListWorkbench />;
}
