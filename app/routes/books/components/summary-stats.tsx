import type { BookCategory } from "../lib/categorize";

export function SummaryStats({
  available,
  soon,
  waiting,
  notFound,
  activeCategory,
  onToggleCategory,
}: {
  available: number;
  soon: number;
  waiting: number;
  notFound: number;
  activeCategory: BookCategory | null;
  onToggleCategory: (cat: BookCategory) => void;
}) {
  const stats: {
    key: BookCategory;
    label: string;
    count: number;
    bg: string;
    activeBg: string;
    border: string;
    activeBorder: string;
    text: string;
  }[] = [
    {
      key: "available",
      label: "AVAILABLE",
      count: available,
      bg: "bg-green-500/10 dark:bg-green-500/20",
      activeBg: "bg-green-500/25 dark:bg-green-500/35",
      border: "border-green-500/30",
      activeBorder: "border-green-500",
      text: "text-green-500",
    },
    {
      key: "soon",
      label: "SOON",
      count: soon,
      bg: "bg-blue-500/10 dark:bg-blue-500/20",
      activeBg: "bg-blue-500/25 dark:bg-blue-500/35",
      border: "border-blue-500/30",
      activeBorder: "border-blue-500",
      text: "text-blue-500",
    },
    {
      key: "waiting",
      label: "WAITING",
      count: waiting,
      bg: "bg-yellow-500/10 dark:bg-yellow-500/20",
      activeBg: "bg-yellow-500/25 dark:bg-yellow-500/35",
      border: "border-yellow-500/30",
      activeBorder: "border-yellow-500",
      text: "text-yellow-500",
    },
    {
      key: "not_found",
      label: "NOT FOUND",
      count: notFound,
      bg: "bg-red-500/10 dark:bg-red-500/20",
      activeBg: "bg-red-500/25 dark:bg-red-500/35",
      border: "border-red-500/30",
      activeBorder: "border-red-500",
      text: "text-red-500",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
      {stats.map((s) => {
        const isActive = activeCategory === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onToggleCategory(s.key)}
            className={`flex flex-col items-center py-3 rounded-xl border transition-all cursor-pointer ${
              isActive
                ? `${s.activeBg} ${s.activeBorder} ring-1 ring-inset ring-current/10`
                : `${s.bg} ${s.border}`
            } ${!isActive && activeCategory ? "opacity-50" : ""}`}
          >
            <span className={`text-2xl sm:text-3xl font-bold ${s.text}`}>{s.count}</span>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
