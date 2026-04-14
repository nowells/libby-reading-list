export const PAGE_SIZE = 20;

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function libbyTitleUrl(libraryKey: string, titleId: string) {
  return `https://libbyapp.com/library/${libraryKey}/everything/page-1/${titleId}`;
}

/** Format an audiobook duration string (e.g. "12:34:56") into a human-readable form */
export function formatDuration(duration: string): string {
  const parts = duration.split(":").map(Number);
  if (parts.length === 3) {
    const [h, m] = parts;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }
  if (parts.length === 2) {
    const [m] = parts;
    return `${m}m`;
  }
  return duration;
}

/** Parse a duration string "HH:MM:SS" into total minutes for comparison */
function durationToMinutes(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1];
  if (parts.length === 2) return parts[0];
  return 0;
}

/** Compute audiobook duration summary from results (e.g. "13h 11m" or "8h 30m – 12h 15m") */
export function formatAudiobookDuration(
  results: Array<{
    formatType: string;
    mediaItem: { formats: Array<{ duration?: string }> };
  }>,
): string | null {
  // Collect all durations from audiobook format entries across all results
  const durations: Array<{ raw: string; mins: number }> = [];
  for (const r of results) {
    if (r.formatType !== "audiobook") continue;
    for (const f of r.mediaItem.formats) {
      if (f.duration) {
        durations.push({ raw: f.duration, mins: durationToMinutes(f.duration) });
      }
    }
  }

  if (durations.length === 0) return null;

  durations.sort((a, b) => a.mins - b.mins);
  const min = durations[0];
  const max = durations[durations.length - 1];
  // Collapse to single value if within 10 minutes
  if (max.mins - min.mins <= 10) return formatDuration(max.raw);
  return `${formatDuration(min.raw)} – ${formatDuration(max.raw)}`;
}
