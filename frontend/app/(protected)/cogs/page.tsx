import type { Metadata } from "next";
import { CogsWorkbench } from "@/components/cogs/CogsWorkbench";

export const metadata: Metadata = {
  title: "Margin watch · COGS",
};

/** Full-screen margin watch — opened in its own browser tab from the Tools menu.
 *  Deliberately NOT under /fashion or /home-decor and with no layout.tsx of its
 *  own, so it mounts neither portal's providers: this page covers every store. */
export default function CogsPage() {
  return <CogsWorkbench />;
}
