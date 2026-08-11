import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  KnowledgeExtractionTargetChangedError,
  KnowledgeExtractionTargetPreview,
  TerritoryDestination,
} from '@nuee/shared-types';
import {
  BUBBLE_EXTRACTION_WRITER,
  type Bubble,
  type BubbleExtractionWriter,
} from '../bubbles/bubble.types';
import { DatabaseTransaction } from '../database/database-transaction';
import { ProjectsService } from '../projects/projects.service';
import { normalizeTerritoryDestination } from '../territories/territory-destination';
import {
  KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
} from './knowledge-extraction.prompt';
import {
  KNOWLEDGE_EXTRACTION_REPOSITORY,
  type KnowledgeExtractionAttempt,
  type KnowledgeExtractionRepository,
  type KnowledgeExtractionResolutionResponse,
} from './knowledge-extraction.types';

type NormalizedResolutionInput =
  | {
      kind: 'new_bubble';
      proposal: {
        title: string;
        summary: string | null;
        content: string;
      };
      destination: TerritoryDestination;
    }
  | {
      kind: 'update_bubble';
      proposal: {
        title: string;
        summary: string | null;
        content: string;
      };
      target_bubble_id: string;
      expected_updated_at: string;
    }
  | {
      kind: 'reject';
    };

@Injectable()
export class KnowledgeExtractionResolutionService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(KNOWLEDGE_EXTRACTION_REPOSITORY)
    private readonly extractions: KnowledgeExtractionRepository,
    @Inject(BUBBLE_EXTRACTION_WRITER)
    private readonly bubbleWriter: BubbleExtractionWriter,
    private readonly transactions: DatabaseTransaction,
  ) {}

  resolveProposal(
    projectId: string,
    discussionId: string,
    extractionId: string,
    input: unknown,
  ): KnowledgeExtractionResolutionResponse {
    this.projects.get(projectId);
    const resolution = this.validateResolutionInput(input);
    const resolutionFingerprint = this.resolutionFingerprint(resolution);

    try {
      return this.transactions.run(() => {
        const attempt = this.extractions.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );

        if (!attempt) {
          throw this.extractionNotFound(projectId, discussionId, extractionId);
        }

        if (attempt.status === 'resolved') {
          return this.replayResolution(
            attempt,
            resolution,
            resolutionFingerprint,
          );
        }

        if (attempt.status === 'discarded') {
          throw new ConflictException({
            code: 'KNOWLEDGE_EXTRACTION_DISCARDED',
            message: 'This extraction attempt has already been discarded.',
          });
        }

        if (attempt.status !== 'ready' || !attempt.proposal) {
          throw new ConflictException({
            code: 'KNOWLEDGE_EXTRACTION_NOT_READY',
            message:
              'This extraction attempt does not have a proposal ready to resolve.',
          });
        }

        const updatedAt = new Date().toISOString();

        if (resolution.kind === 'reject') {
          const resolved = this.extractions.markResolved(
            projectId,
            discussionId,
            extractionId,
            {
              fingerprint: resolutionFingerprint,
              kind: 'reject',
              resulting_bubble_id: null,
              updated_at: updatedAt,
            },
          );

          if (!resolved) {
            throw new Error('The rejected resolution was not persisted.');
          }

          return this.toRejectedResolutionResponse(resolved);
        }

        const provenance = {
          project_id: projectId,
          extraction_id: extractionId,
          title: resolution.proposal.title,
          summary: resolution.proposal.summary,
          content: resolution.proposal.content,
          source_discussion_id: discussionId,
          source_discussion_title: attempt.source_snapshot.discussion_title,
          source_message_ids: attempt.source_snapshot.messages.map(
            ({ source_id }) => source_id,
          ),
          source_context_item_ids:
            attempt.source_snapshot.frozen_context_items.map(
              ({ source_id }) => source_id,
            ),
        };

        if (resolution.kind === 'new_bubble') {
          const bubbleResult = this.bubbleWriter.createFromDiscussionExtraction(
            {
              ...provenance,
              destination: resolution.destination,
            },
          );

          if (bubbleResult.status === 'extraction_conflict') {
            throw this.resolutionConflict();
          }

          const resolved = this.extractions.markResolved(
            projectId,
            discussionId,
            extractionId,
            {
              fingerprint: resolutionFingerprint,
              kind: 'new_bubble',
              resulting_bubble_id: bubbleResult.bubble.id,
              updated_at: updatedAt,
            },
          );

          if (!resolved) {
            throw new Error('The new-bubble resolution was not persisted.');
          }

          return this.toNewBubbleResolutionResponse(
            resolved,
            bubbleResult.bubble,
          );
        }

        const bubbleResult = this.bubbleWriter.updateFromDiscussionExtraction({
          ...provenance,
          bubble_id: resolution.target_bubble_id,
          expected_updated_at: resolution.expected_updated_at,
        });

        if (bubbleResult.status === 'extraction_conflict') {
          throw this.resolutionConflict();
        }

        if (bubbleResult.status === 'target_missing') {
          throw this.targetNotFound(projectId, resolution.target_bubble_id);
        }

        if (bubbleResult.status === 'target_changed') {
          throw this.targetChanged(bubbleResult.bubble);
        }

        const resolved = this.extractions.markResolved(
          projectId,
          discussionId,
          extractionId,
          {
            fingerprint: resolutionFingerprint,
            kind: 'update_bubble',
            resulting_bubble_id: bubbleResult.bubble.id,
            updated_at: updatedAt,
          },
        );

        if (!resolved) {
          throw new Error('The bubble-update resolution was not persisted.');
        }

        return this.toUpdateBubbleResolutionResponse(
          resolved,
          bubbleResult.bubble,
        );
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw this.resolutionPersistenceFailed();
    }
  }

  discardProposal(
    projectId: string,
    discussionId: string,
    extractionId: string,
  ): void {
    this.projects.get(projectId);

    try {
      this.transactions.run(() => {
        const attempt = this.extractions.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );

        if (!attempt) {
          throw this.extractionNotFound(projectId, discussionId, extractionId);
        }

        if (attempt.status === 'discarded') {
          return;
        }

        if (attempt.status === 'resolved') {
          throw this.resolutionConflict();
        }

        const discarded = this.extractions.markDiscarded(
          projectId,
          discussionId,
          extractionId,
          new Date().toISOString(),
        );

        if (!discarded) {
          throw new Error('The extraction attempt was not discarded.');
        }
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw this.resolutionPersistenceFailed();
    }
  }

  private replayResolution(
    attempt: KnowledgeExtractionAttempt,
    resolution: NormalizedResolutionInput,
    resolutionFingerprint: string,
  ): KnowledgeExtractionResolutionResponse {
    if (
      attempt.resolution_kind !== resolution.kind ||
      attempt.resolution_fingerprint !== resolutionFingerprint
    ) {
      throw this.resolutionConflict();
    }

    if (resolution.kind === 'reject') {
      return this.toRejectedResolutionResponse(attempt);
    }

    const bubble = this.bubbleWriter.findByDiscussionExtraction(
      attempt.project_id,
      attempt.id,
    );

    if (!bubble || bubble.id !== attempt.resulting_bubble_id) {
      throw new Error('The resolved extraction bubble is unavailable.');
    }

    return resolution.kind === 'new_bubble'
      ? this.toNewBubbleResolutionResponse(attempt, bubble)
      : this.toUpdateBubbleResolutionResponse(attempt, bubble);
  }

  private toNewBubbleResolutionResponse(
    attempt: KnowledgeExtractionAttempt,
    bubble: Bubble,
  ): KnowledgeExtractionResolutionResponse {
    return {
      id: attempt.id,
      project_id: attempt.project_id,
      discussion_id: attempt.discussion_id,
      status: 'resolved',
      resolution: {
        kind: 'new_bubble',
        bubble,
      },
    };
  }

  private toRejectedResolutionResponse(
    attempt: KnowledgeExtractionAttempt,
  ): KnowledgeExtractionResolutionResponse {
    return {
      id: attempt.id,
      project_id: attempt.project_id,
      discussion_id: attempt.discussion_id,
      status: 'resolved',
      resolution: {
        kind: 'reject',
      },
    };
  }

  private toUpdateBubbleResolutionResponse(
    attempt: KnowledgeExtractionAttempt,
    bubble: Bubble,
  ): KnowledgeExtractionResolutionResponse {
    return {
      id: attempt.id,
      project_id: attempt.project_id,
      discussion_id: attempt.discussion_id,
      status: 'resolved',
      resolution: {
        kind: 'update_bubble',
        bubble,
      },
    };
  }

  private validateResolutionInput(input: unknown): NormalizedResolutionInput {
    const fieldErrors: Record<string, string> = {};

    if (!this.isRecord(input)) {
      throw this.resolutionValidationFailed({
        request_body: 'Request body must be a JSON object.',
      });
    }

    if (input.kind === 'reject') {
      this.rejectUnknownFields(input, ['kind'], fieldErrors);

      if (Object.keys(fieldErrors).length > 0) {
        throw this.resolutionValidationFailed(fieldErrors);
      }

      return { kind: 'reject' };
    }

    if (input.kind !== 'new_bubble' && input.kind !== 'update_bubble') {
      this.rejectUnknownFields(
        input,
        ['kind', 'proposal', 'target_bubble_id', 'expected_updated_at'],
        fieldErrors,
      );
      fieldErrors.kind =
        'Resolution kind must be "new_bubble", "update_bubble", or "reject".';
      throw this.resolutionValidationFailed(fieldErrors);
    }

    this.rejectUnknownFields(
      input,
      input.kind === 'update_bubble'
        ? ['kind', 'proposal', 'target_bubble_id', 'expected_updated_at']
        : ['kind', 'proposal', 'destination'],
      fieldErrors,
    );

    if (!this.isRecord(input.proposal)) {
      fieldErrors.proposal = 'Reviewed proposal must be an object.';
    } else {
      this.rejectUnknownFields(
        input.proposal,
        ['title', 'summary', 'content'],
        fieldErrors,
        'proposal.',
      );
    }

    const proposal = this.isRecord(input.proposal) ? input.proposal : undefined;
    const title = this.reviewedRequiredText(
      proposal?.title,
      'proposal.title',
      'Title',
      KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
      fieldErrors,
    );
    const summary = this.reviewedSummary(proposal?.summary, fieldErrors);
    const content = this.reviewedRequiredText(
      proposal?.content,
      'proposal.content',
      'Content',
      KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH,
      fieldErrors,
    );
    const targetBubbleId =
      input.kind === 'update_bubble'
        ? this.reviewedIdentifier(
            input.target_bubble_id,
            'target_bubble_id',
            'Target bubble identifier',
            fieldErrors,
          )
        : undefined;
    const expectedUpdatedAt =
      input.kind === 'update_bubble'
        ? this.reviewedIdentifier(
            input.expected_updated_at,
            'expected_updated_at',
            'Observed target update timestamp',
            fieldErrors,
          )
        : undefined;
    const destination =
      input.kind === 'new_bubble'
        ? this.reviewedDestination(input.destination, fieldErrors)
        : undefined;

    if (Object.keys(fieldErrors).length > 0) {
      throw this.resolutionValidationFailed(fieldErrors);
    }

    if (title === undefined || summary === undefined || content === undefined) {
      throw new Error(
        'Validated knowledge extraction resolution is unexpectedly missing.',
      );
    }

    const reviewedProposal = { title, summary, content };

    if (input.kind === 'new_bubble') {
      if (destination === undefined) {
        throw new Error(
          'Validated new-bubble destination is unexpectedly missing.',
        );
      }

      return {
        kind: 'new_bubble',
        proposal: reviewedProposal,
        destination,
      };
    }

    if (targetBubbleId === undefined || expectedUpdatedAt === undefined) {
      throw new Error(
        'Validated bubble-update resolution is unexpectedly missing.',
      );
    }

    return {
      kind: 'update_bubble',
      proposal: reviewedProposal,
      target_bubble_id: targetBubbleId,
      expected_updated_at: expectedUpdatedAt,
    };
  }

  private reviewedRequiredText(
    value: unknown,
    field: string,
    label: string,
    maximumLength: number,
    fieldErrors: Record<string, string>,
  ): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fieldErrors[field] = `${label} is required.`;
      return undefined;
    }

    const normalized = value.trim();

    if (normalized.length > maximumLength) {
      fieldErrors[field] =
        `${label} must be ${maximumLength} characters or fewer.`;
      return undefined;
    }

    return normalized;
  }

  private reviewedSummary(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): string | null | undefined {
    if (typeof value !== 'string') {
      fieldErrors['proposal.summary'] = 'Summary must be text.';
      return undefined;
    }

    const normalized = value.trim();

    if (normalized.length > KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH) {
      fieldErrors['proposal.summary'] =
        `Summary must be ${KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH} characters or fewer.`;
      return undefined;
    }

    return normalized.length === 0 ? null : normalized;
  }

  private reviewedIdentifier(
    value: unknown,
    field: string,
    label: string,
    fieldErrors: Record<string, string>,
  ): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fieldErrors[field] = `${label} is required.`;
      return undefined;
    }

    return value.trim();
  }

  private reviewedDestination(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): TerritoryDestination | undefined {
    const normalized = normalizeTerritoryDestination(value);

    if (!normalized.valid) {
      for (const [field, message] of Object.entries(normalized.fieldErrors)) {
        fieldErrors[field === 'destination' ? field : `destination.${field}`] =
          message;
      }

      return undefined;
    }

    return normalized.destination;
  }

  private resolutionFingerprint(resolution: NormalizedResolutionInput): string {
    return createHash('sha256')
      .update(JSON.stringify(resolution))
      .digest('hex');
  }

  private extractionNotFound(
    projectId: string,
    discussionId: string,
    extractionId: string,
  ): NotFoundException {
    return new NotFoundException({
      code: 'KNOWLEDGE_EXTRACTION_NOT_FOUND',
      message: `Knowledge extraction "${extractionId}" was not found in discussion "${discussionId}" in project "${projectId}".`,
    });
  }

  private resolutionConflict(): ConflictException {
    return new ConflictException({
      code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_CONFLICT',
      message: 'This extraction attempt has already been resolved differently.',
    });
  }

  private targetNotFound(
    projectId: string,
    bubbleId: string,
  ): NotFoundException {
    return new NotFoundException({
      code: 'KNOWLEDGE_EXTRACTION_TARGET_NOT_FOUND',
      message: `Target bubble "${bubbleId}" was not found in project "${projectId}".`,
    });
  }

  private targetChanged(bubble: Bubble): ConflictException {
    const currentTarget: KnowledgeExtractionTargetPreview = {
      id: bubble.id,
      title: bubble.title,
      summary: bubble.summary,
      content: bubble.content,
      updated_at: bubble.updated_at,
    };
    const response: KnowledgeExtractionTargetChangedError = {
      code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
      message:
        'The target bubble changed after it was selected. Review the current target before confirming again.',
      current_target: currentTarget,
    };

    return new ConflictException(response);
  }

  private resolutionValidationFailed(
    fieldErrors: Record<string, string>,
  ): BadRequestException {
    return new BadRequestException({
      code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_VALIDATION_FAILED',
      message: 'Knowledge extraction resolution is invalid.',
      field_errors: fieldErrors,
    });
  }

  private resolutionPersistenceFailed(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_PERSISTENCE_FAILED',
      message:
        'The extraction resolution could not be saved. The proposal is still available to retry.',
    });
  }

  private rejectUnknownFields(
    value: Record<string, unknown>,
    allowedFields: readonly string[],
    fieldErrors: Record<string, string>,
    prefix = '',
  ): void {
    for (const field of Object.keys(value)) {
      if (!allowedFields.includes(field)) {
        fieldErrors[`${prefix}${field}`] = 'Unknown field.';
      }
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
