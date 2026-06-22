import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names (clsx) and de-dupe conflicting Tailwind utilities (tailwind-merge).
 *  The shadcn `cn` helper — imported by ui components like aurora-background. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
