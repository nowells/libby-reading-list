import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Open Library descriptions and bios are stored as Markdown but were being
 * rendered as plain text, so syntax like `[label](url)`, reference-style
 * footnotes, and `----` horizontal rules leaked through visibly. This
 * component renders those strings safely: raw HTML in the source is stripped
 * (rather than being passed through, which would risk XSS from third-party
 * data), then react-markdown converts the rest to React elements.
 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`shelfcheck-markdown ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {stripHtmlTags(source)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Truncate Markdown source for a "Show more" toggle without slicing through
 * the middle of a link, image, or reference definition. We prefer to break at
 * a paragraph boundary, then a line break, then a word boundary.
 */
export function truncateMarkdown(source: string, maxLen: number): string {
  if (source.length <= maxLen) return source;
  const slice = source.slice(0, maxLen);
  const minBreak = Math.floor(maxLen * 0.5);
  const candidates = [slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" ")];
  for (const idx of candidates) {
    if (idx >= minBreak) return slice.slice(0, idx).trimEnd() + "…";
  }
  return slice.trimEnd() + "…";
}

/**
 * Strip HTML tags from the source while preserving their text content. Open
 * Library bios occasionally include things like `<sup>[1]</sup>`; without
 * this, react-markdown's default (HTML disabled) would render the tags as
 * escaped text. Enabling rehype-raw would render them properly but opens an
 * XSS hole for arbitrary third-party data, so we drop the tags instead.
 */
function stripHtmlTags(source: string): string {
  return source.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

const LINK_CLASS = "text-amber-600 hover:text-amber-700 dark:text-amber-400 underline";

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc ml-5 mb-3 last:mb-0 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-5 mb-3 last:mb-0 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => (
    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h4>
  ),
  h6: ({ children }) => (
    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 mt-3 first:mt-0">
      {children}
    </h4>
  ),
  hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400 mb-3 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[0.85em] font-mono">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="p-3 rounded bg-gray-100 dark:bg-gray-700 overflow-x-auto text-xs font-mono mb-3 last:mb-0">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};
