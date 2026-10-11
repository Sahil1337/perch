import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins classes, letting a later class win over an earlier one it conflicts with. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
