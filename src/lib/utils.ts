import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard cn() helper used by every shadcn-style component. Lets us merge Tailwind classes
// from props without specificity conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
