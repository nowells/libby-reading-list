import { FormatIcon } from "~/components/format-icon";
import type { FormatFilter } from "../lib/categorize";

export function FormatFilterBar({
  active,
  onToggle,
}: {
  active: FormatFilter;
  onToggle: (f: FormatFilter) => void;
}) {
  const options: { key: FormatFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: null },
    {
      key: "ebook",
      label: "eBooks",
      icon: <FormatIcon type="ebook" />,
    },
    {
      key: "audiobook",
      label: "Audiobooks",
      icon: <FormatIcon type="audiobook" />,
    },
  ];

  return (
    <div className="flex items-center gap-2 mb-6">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onToggle(o.key)}
          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
            active === o.key
              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
