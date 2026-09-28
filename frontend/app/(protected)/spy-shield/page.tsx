import type { Metadata } from "next";
import { SpyShieldWorkbench } from "@/components/spy-shield/SpyShieldWorkbench";

export const metadata: Metadata = {
  title: "Spy Shield",
};

/** Full-screen Spy Shield monitor — opened in its own browser tab from the Tools
 *  menu. Like /cogs it lives outside /fashion and /home-decor and has no
 *  layout.tsx of its own: it covers all six stores, so it mounts neither
 *  portal's providers. */
export default function SpyShieldPage() {
  return <SpyShieldWorkbench />;
}
