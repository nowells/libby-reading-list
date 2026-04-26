import { useState } from "react";

/**
 * 0-5 star rating with half-star resolution. Stored as a 0-100 integer
 * (lexicon convention: 10 == 0.5★, 100 == 5★) and rendered as five
 * clickable star slots; the left half of each slot is a half-star, the
 * right half is a full star.
 */
export function StarRating({
  value,
  onChange,
  size = 18,
  readOnly = false,
  className = "",
}: {
  /** 0-100 (or undefined for unset). */
  value: number | undefined;
  onChange?: (next: number | undefined) => void;
  size?: number;
  readOnly?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value ?? 0; // 0-100

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className}`}
      onMouseLeave={() => setHover(null)}
      role={readOnly ? undefined : "slider"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? 0}
    >
      {[0, 1, 2, 3, 4].map((slot) => {
        const halfFilled = display >= slot * 20 + 10;
        const fullFilled = display >= slot * 20 + 20;
        return (
          <span key={slot} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} filled={fullFilled} half={halfFilled && !fullFilled} />
            {!readOnly && (
              <>
                <button
                  type="button"
                  aria-label={`${slot * 20 + 10} percent`}
                  onMouseEnter={() => setHover(slot * 20 + 10)}
                  onClick={() => onChange?.(value === slot * 20 + 10 ? undefined : slot * 20 + 10)}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                />
                <button
                  type="button"
                  aria-label={`${slot * 20 + 20} percent`}
                  onMouseEnter={() => setHover(slot * 20 + 20)}
                  onClick={() => onChange?.(value === slot * 20 + 20 ? undefined : slot * 20 + 20)}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                />
              </>
            )}
          </span>
        );
      })}
      {!readOnly && value !== undefined && (
        <button
          type="button"
          onClick={() => onChange?.(undefined)}
          className="ml-1.5 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Clear rating"
        >
          clear
        </button>
      )}
    </div>
  );
}

function Star({ size, filled, half }: { size: number; filled: boolean; half: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={
        filled || half ? "text-amber-400 dark:text-amber-300" : "text-gray-300 dark:text-gray-600"
      }
    >
      <defs>
        <linearGradient id={`half-${size}`}>
          <stop offset="50%" stopColor="currentColor" />
          <stop offset="50%" stopColor="transparent" stopOpacity={1} />
        </linearGradient>
      </defs>
      <path
        d="M12 2l2.9 6.6L22 9.3l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.9L2 9.3l7.1-.7L12 2z"
        fill={filled ? "currentColor" : half ? `url(#half-${size})` : "none"}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
