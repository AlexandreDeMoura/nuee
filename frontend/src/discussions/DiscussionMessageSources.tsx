import { ExternalLink, Search } from 'lucide-react';
import type { DiscussionMessage } from '../api';

interface SafeMessageCitation {
  href: string;
  label: string;
  snippet?: string;
}

function safeHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function safeMessageCitations(
  citations: DiscussionMessage['citations'],
): SafeMessageCitation[] {
  if (!Array.isArray(citations)) {
    return [];
  }

  return citations.flatMap((citation) => {
    if (!citation || typeof citation !== 'object') {
      return [];
    }

    const url = safeHttpUrl(citation.url);

    if (!url) {
      return [];
    }

    const title =
      typeof citation.title === 'string' ? citation.title.trim() : '';
    const snippet =
      typeof citation.snippet === 'string' && citation.snippet.trim().length > 0
        ? citation.snippet.trim()
        : undefined;

    return [
      {
        href: url.href,
        label: title || url.hostname,
        ...(snippet ? { snippet } : {}),
      },
    ];
  });
}

export function DiscussionMessageSources({
  citations,
}: {
  citations: DiscussionMessage['citations'];
}) {
  const safeCitations = safeMessageCitations(citations);

  return (
    <section
      aria-label="Web search sources"
      className="mt-3 rounded-xl border border-[#dfe5ed] bg-[#f8fafc] px-3.5 py-3"
      data-web-search-sources
    >
      <div className="flex items-center gap-2 text-[11.5px] font-semibold text-[#526174]">
        <Search className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        Searched the web
      </div>
      {safeCitations.length > 0 ? (
        <ol className="mt-2.5 space-y-2" aria-label="Cited web sources">
          {safeCitations.map((citation, index) => (
            <li className="min-w-0" key={`${citation.href}:${index}`}>
              <a
                aria-label={`Open source: ${citation.label} (opens in a new tab)`}
                className="group inline-flex max-w-full items-center gap-1.5 text-[12px] font-medium text-[#3f63a8] hover:text-[#294b87] focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25"
                href={citation.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                <span className="truncate underline decoration-[#aebed8] underline-offset-2">
                  {citation.label}
                </span>
                <ExternalLink
                  className="size-3 shrink-0"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </a>
              {citation.snippet && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.45] text-[#728096]">
                  {citation.snippet}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 text-[11px] leading-[1.45] text-[#728096]">
          No web sources were cited for this response.
        </p>
      )}
    </section>
  );
}
