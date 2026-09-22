import type { Priority } from "@calendar/domain";

export interface PriorityVisual {
  label: string;
  badgeClass: string;
  borderClass: string;
  dotClass: string;
  eventColor: string;
}

export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low", "none"];
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
export const PRIORITY_META: Record<Priority, PriorityVisual> = {
  urgent: { label: "紧急", badgeClass: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200", borderClass: "border-l-red-500", dotClass: "bg-red-500", eventColor: "#dc2626" },
  high: { label: "高", badgeClass: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-200", borderClass: "border-l-violet-500", dotClass: "bg-violet-500", eventColor: "#7c3aed" },
  medium: { label: "中", badgeClass: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200", borderClass: "border-l-amber-500", dotClass: "bg-amber-500", eventColor: "#d97706" },
  low: { label: "低", badgeClass: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200", borderClass: "border-l-sky-500", dotClass: "bg-sky-500", eventColor: "#0284c7" },
  none: { label: "无", badgeClass: "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200", borderClass: "border-l-transparent", dotClass: "bg-stone-400", eventColor: "#f97316" }
};