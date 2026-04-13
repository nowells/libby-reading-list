export function Logo({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Bookshelf base */}
      <rect
        x="6"
        y="52"
        width="52"
        height="4"
        rx="1"
        fill="currentColor"
        className="text-amber-700 dark:text-amber-500"
      />

      {/* Book 1 - tall, tilted left */}
      <rect
        x="12"
        y="14"
        width="8"
        height="38"
        rx="1.5"
        fill="currentColor"
        className="text-blue-500 dark:text-blue-400"
        transform="rotate(-4 12 14)"
      />

      {/* Book 2 - medium */}
      <rect
        x="22"
        y="20"
        width="8"
        height="32"
        rx="1.5"
        fill="currentColor"
        className="text-amber-500 dark:text-amber-400"
      />

      {/* Book 3 - short */}
      <rect
        x="32"
        y="26"
        width="8"
        height="26"
        rx="1.5"
        fill="currentColor"
        className="text-emerald-500 dark:text-emerald-400"
      />

      {/* Book 4 - tall, tilted right */}
      <rect
        x="42"
        y="16"
        width="8"
        height="36"
        rx="1.5"
        fill="currentColor"
        className="text-rose-400 dark:text-rose-400"
        transform="rotate(3 42 16)"
      />

      {/* Checkmark circle */}
      <circle
        cx="50"
        cy="14"
        r="12"
        fill="currentColor"
        className="text-green-500 dark:text-green-400"
      />
      <path
        d="M44 14l4 4 8-8"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
