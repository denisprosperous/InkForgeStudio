/**
 * @inkforge/ui/primitives — shared styling primitives for every Inkforge surface.
 *
 * One `cn()` (clsx + tailwind-merge) and one variant helper (cva) so the web
 * app, future marketing surfaces and any white-label skin compose classes the
 * same way. No React components here — those live in ./studio — so this module
 * is safe to import from server code.
 */
import { clsx, type ClassValue } from "clsx";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/** Merge conditional class lists, resolving Tailwind conflicts last-write-wins. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { cva, type VariantProps };
