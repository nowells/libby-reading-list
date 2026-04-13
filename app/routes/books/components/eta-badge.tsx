import { SOON_THRESHOLD_DAYS } from "../lib/categorize";

export function EtaBadge({ days }: { days?: number }) {
  if (days == null) return <span className="text-gray-400 dark:text-gray-500">&mdash;</span>;
  let color = "text-red-500 dark:text-red-400";
  if (days <= 7) color = "text-green-500 dark:text-green-400";
  else if (days <= SOON_THRESHOLD_DAYS) color = "text-blue-500 dark:text-blue-400";
  else if (days <= 60) color = "text-yellow-500 dark:text-yellow-400";
  return <span className={`font-medium ${color}`}>~{days}d</span>;
}
