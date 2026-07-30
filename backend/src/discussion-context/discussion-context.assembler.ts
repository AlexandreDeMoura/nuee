import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  DiscussionContextSelectionInput,
  FrozenContextItem,
  FrozenContextV1,
} from '@nuee/shared-types';
import { BUBBLE_CONTEXT_SOURCE_READER } from '../bubbles/bubble.types';
import type {
  BubbleContextSource,
  BubbleContextSourceReader,
} from '../bubbles/bubble.types';
import { ProjectsService } from '../projects/projects.service';
import {
  DOCUMENT_CONTEXT_SOURCE_READER,
  DiscussionContextSourceError,
} from './discussion-context.types';
import type {
  DiscussionContextSourceIssue,
  DocumentContextSource,
  DocumentContextSourceReader,
} from './discussion-context.types';

const PROJECT_DESCRIPTION_TITLE = 'Project description';

type ReadyDocumentContextSource = Omit<
  DocumentContextSource,
  'processing_status' | 'processed_text'
> & {
  processing_status: 'ready';
  processed_text: string;
};

@Injectable()
export class DiscussionContextAssembler {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(BUBBLE_CONTEXT_SOURCE_READER)
    private readonly bubbles: BubbleContextSourceReader,
    @Optional()
    @Inject(DOCUMENT_CONTEXT_SOURCE_READER)
    private readonly documents?: DocumentContextSourceReader,
  ) {}

  assemble(
    projectId: string,
    selection: DiscussionContextSelectionInput,
  ): FrozenContextV1 {
    const project = this.projects.get(projectId);
    const bubbleIds = this.deduplicate(selection.bubble_ids);
    const documentIds = this.deduplicate(selection.document_ids);
    const issues: DiscussionContextSourceIssue[] = [];
    const bubbleSources = this.readBubbles(projectId, bubbleIds, issues);
    const documentSources = this.readDocuments(projectId, documentIds, issues);

    if (issues.length > 0) {
      throw new DiscussionContextSourceError(issues);
    }

    const createdAt = new Date().toISOString();
    const items: FrozenContextItem[] = [
      {
        id: randomUUID(),
        source_kind: 'project_description',
        source_id: project.id,
        source_title: PROJECT_DESCRIPTION_TITLE,
        frozen_content: project.description,
        created_at: createdAt,
        display_order: 0,
      },
    ];

    for (const source of bubbleSources) {
      items.push({
        id: randomUUID(),
        source_kind: 'bubble',
        source_id: source.id,
        source_title: source.title,
        frozen_content: source.content,
        created_at: createdAt,
        display_order: items.length,
      });
    }

    for (const source of documentSources) {
      items.push({
        id: randomUUID(),
        source_kind: 'document',
        source_id: source.id,
        source_title: source.title,
        frozen_content: source.processed_text,
        created_at: createdAt,
        display_order: items.length,
      });
    }

    return { version: 1, items };
  }

  private readBubbles(
    projectId: string,
    bubbleIds: readonly string[],
    issues: DiscussionContextSourceIssue[],
  ): BubbleContextSource[] {
    const sources: BubbleContextSource[] = [];

    for (const sourceId of bubbleIds) {
      const result = this.bubbles.readContextSource(projectId, sourceId);

      if (result.status === 'unavailable') {
        issues.push({
          source_kind: 'bubble',
          source_id: sourceId,
          reason: result.reason,
        });
        continue;
      }

      if (result.source.project_id !== projectId) {
        issues.push({
          source_kind: 'bubble',
          source_id: sourceId,
          reason: 'cross_project',
        });
        continue;
      }

      if (
        result.source.id !== sourceId ||
        !this.isNonEmptyString(result.source.title) ||
        !this.isNonEmptyString(result.source.content)
      ) {
        issues.push({
          source_kind: 'bubble',
          source_id: sourceId,
          reason: 'inaccessible',
        });
        continue;
      }

      sources.push(result.source);
    }

    return sources;
  }

  private readDocuments(
    projectId: string,
    documentIds: readonly string[],
    issues: DiscussionContextSourceIssue[],
  ): ReadyDocumentContextSource[] {
    const sources: ReadyDocumentContextSource[] = [];

    for (const sourceId of documentIds) {
      const result = this.documents?.readContextSource(projectId, sourceId);

      if (!result || result.status === 'unavailable') {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: result?.reason ?? 'inaccessible',
        });
        continue;
      }

      if (result.source.project_id !== projectId) {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: 'cross_project',
        });
        continue;
      }

      if (
        result.source.id !== sourceId ||
        !this.isNonEmptyString(result.source.title)
      ) {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: 'inaccessible',
        });
        continue;
      }

      const processingStatus: unknown = result.source.processing_status;

      if (processingStatus === 'processing' || processingStatus === 'failed') {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: processingStatus,
        });
        continue;
      }

      if (processingStatus !== 'ready') {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: 'failed',
        });
        continue;
      }

      if (
        typeof result.source.processed_text !== 'string' ||
        result.source.processed_text.trim().length === 0
      ) {
        issues.push({
          source_kind: 'document',
          source_id: sourceId,
          reason: 'failed',
        });
        continue;
      }

      sources.push({
        ...result.source,
        processing_status: 'ready',
        processed_text: result.source.processed_text,
      });
    }

    return sources;
  }

  private deduplicate(sourceIds: readonly string[]): string[] {
    return [...new Set(sourceIds)];
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
