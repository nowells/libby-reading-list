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
