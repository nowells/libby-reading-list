import { useState } from "react";
import type { LibraryConfig } from "~/lib/storage";

function LibraryInitial({ name, libraryKey }: { name?: string; libraryKey: string }) {
  const initial = name?.[0]?.toUpperCase() ?? "L";
  return (
    <span
      title={name ?? libraryKey}
      className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-gray-200 dark:bg-gray-600 text-[11px] font-bold text-gray-600 dark:text-gray-300 flex-shrink-0"
    >
      {initial}
    </span>
  );
}

export function LibraryIcon({
  libraryKey,
  libraries,
  className,
}: {
  libraryKey: string;
  libraries: LibraryConfig[];
  className?: string;
}) {
  const lib = libraries.find((l) => l.key === libraryKey);
  const [imgError, setImgError] = useState(false);

  if (lib?.logoUrl && !imgError) {
    return (
      <img
        src={lib.logoUrl}
        alt={lib.name}
        title={lib.name}
        className={
          className ?? "h-5 min-w-8 w-auto rounded bg-white p-0.5 flex-shrink-0 object-contain"
        }
        onError={() => setImgError(true)}
      />
    );
  }

  return <LibraryInitial name={lib?.name} libraryKey={libraryKey} />;
}

export function LibraryName({
  libraryKey,
  libraries,
}: {
  libraryKey: string;
  libraries: LibraryConfig[];
}) {
  const lib = libraries.find((l) => l.key === libraryKey);
  return <>{lib?.name ?? libraryKey}</>;
}
