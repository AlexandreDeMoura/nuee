export interface DiscussionBubbleSource {
  readonly id: string;
  readonly kind: 'bubble';
  readonly secondaryLine: string;
  readonly title: string;
}

export type DiscussionDocumentReadiness =
  | { readonly status: 'ready' }
  | {
      readonly reason: 'failed' | 'processing';
      readonly status: 'not_ready';
    };

export interface DiscussionDocumentSource {
  readonly id: string;
  readonly kind: 'document';
  readonly readiness: DiscussionDocumentReadiness;
  readonly secondaryLine: string;
  readonly title: string;
}

export type DiscussionSourceCatalogItem =
  | DiscussionBubbleSource
  | DiscussionDocumentSource;

/**
 * The read-only project knowledge exposed to a new discussion draft.
 * Source bodies remain in their owning features and are frozen by the server
 * only when the draft is submitted.
 */
export interface DiscussionSourceCatalog {
  readonly projectId: string;
  readonly sources: readonly DiscussionSourceCatalogItem[];
}

function searchableText(source: DiscussionSourceCatalogItem): string {
  return `${source.title} ${source.secondaryLine}`.toLocaleLowerCase();
}

export function filterDiscussionSourceCatalog(
  catalog: DiscussionSourceCatalog,
  query: string,
): readonly DiscussionSourceCatalogItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return catalog.sources;
  }

  return catalog.sources.filter((source) =>
    searchableText(source).includes(normalizedQuery),
  );
}
