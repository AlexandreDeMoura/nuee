import type { Bubble, DocumentSummary } from '../api';
import type {
  DiscussionDocumentReadiness,
  DiscussionSourceCatalog,
} from '../discussions/discussionSourceCatalog';
import { formatDocumentSize } from '../documents/documentPresentation';

export interface ProjectSourceCatalogInput {
  readonly bubbles: readonly Bubble[];
  readonly documents: readonly DocumentSummary[];
  readonly projectId: string;
}

function bubbleSecondaryLine(bubble: Bubble): string {
  const summary = bubble.summary?.trim();

  if (summary) {
    return summary;
  }

  return 'Project bubble';
}

function documentReadiness(
  document: DocumentSummary,
): DiscussionDocumentReadiness {
  return document.processing_status === 'ready'
    ? { status: 'ready' }
    : {
        reason: document.processing_status,
        status: 'not_ready',
      };
}

export function createProjectSourceCatalog({
  bubbles,
  documents,
  projectId,
}: ProjectSourceCatalogInput): DiscussionSourceCatalog {
  return {
    projectId,
    sources: [
      ...bubbles
        .filter((bubble) => bubble.project_id === projectId)
        .map((bubble) => ({
          id: bubble.id,
          kind: 'bubble' as const,
          secondaryLine: bubbleSecondaryLine(bubble),
          title: bubble.title,
        })),
      ...documents
        .filter((document) => document.project_id === projectId)
        .map((document) => ({
          id: document.id,
          kind: 'document' as const,
          readiness: documentReadiness(document),
          secondaryLine: `Whole document · ${formatDocumentSize(document.size_bytes)}`,
          title: document.title,
        })),
    ],
  };
}
