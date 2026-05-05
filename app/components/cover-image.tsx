import { useState } from "react";

const SIZES = {
  sm: { wrapper: "w-12 h-[4.5rem]", icon: "w-6 h-6" },
  md: { wrapper: "w-20 h-28 sm:w-24 sm:h-36", icon: "w-8 h-8" },
} as const;

export function CoverImage({
  src,
  alt,
  size = "sm",
}: {
  src?: string;
  alt: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const sizing = SIZES[size];

  if (!src || failed) {
    return (
      <div
        className={`${sizing.wrapper} rounded-md flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center`}
      >
        <svg
          className={`${sizing.icon} text-gray-400 dark:text-gray-500`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`${sizing.wrapper} object-cover rounded-md flex-shrink-0 shadow-sm`}
      onError={() => setFailed(true)}
    />
  );
}
