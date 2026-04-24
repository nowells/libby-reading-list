import { useTheme, type Theme } from "~/lib/theme";

const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
        />
      </svg>
    ),
  },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          title={o.label}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
            theme === o.value
              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
              : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
