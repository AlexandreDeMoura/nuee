import type {
  DiscussionContextSourceKind,
  DocumentSummary,
} from '@nuee/shared-types';

export type { DocumentProcessingStatus } from '@nuee/shared-types';

export interface DocumentContextSource extends Pick<
  DocumentSummary,
  'id' | 'project_id' | 'title' | 'processing_status'
> {
  processed_text: string | null;
}

export type DocumentContextSourceReadResult =
  | {
      status: 'available';
      source: DocumentContextSource;
    }
  | {
      status: 'unavailable';
      reason: 'missing' | 'inaccessible' | 'cross_project';
    };

/**
 * Consumer-side port for the future Document Library context-source contract.
 * The owning feature must resolve through the project and return complete
 * processed text only; Discussion Context never reads document storage itself.
 */
export interface DocumentContextSourceReader {
  readContextSource(
    projectId: string,
    documentId: string,
  ): DocumentContextSourceReadResult;
}

export type DiscussionContextSourceIssueReason =
  'missing' | 'inaccessible' | 'cross_project' | 'processing' | 'failed';

export interface DiscussionContextSourceIssue {
  source_kind: Exclude<DiscussionContextSourceKind, 'project_description'>;
  source_id: string;
  reason: DiscussionContextSourceIssueReason;
}

export const DOCUMENT_CONTEXT_SOURCE_READER = Symbol(
  'DOCUMENT_CONTEXT_SOURCE_READER',
);

export class DiscussionContextSourceError extends Error {
  readonly code = 'DISCUSSION_CONTEXT_SOURCE_INVALID';

  constructor(readonly issues: readonly DiscussionContextSourceIssue[]) {
    super('One or more selected discussion context sources are unavailable.');
    this.name = 'DiscussionContextSourceError';
  }
}
