import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProjectsService } from '../projects/projects.service';
import { BUBBLE_REPOSITORY } from './bubble.types';
import type {
  BatchRepositionBubblesInput,
  Bubble,
  BubbleContextSourceReadResult,
  BubbleContextSourceReader,
  BubbleExtractionWriter,
  BubblePositionUpdate,
  BubbleRepository,
  CreateBubbleFromDiscussionExtractionInput,
  CreateBubbleFromDiscussionExtractionResult,
  CreateBubbleInput,
  PersistedBubble,
  RepositionBubbleInput,
  UpdateBubbleFromDiscussionExtractionInput,
  UpdateBubbleFromDiscussionExtractionResult,
  UpdateBubbleInput,
} from './bubble.types';

type BubbleTextField = 'title' | 'content';
type BubblePositionField = 'position_x' | 'position_y';

interface NormalizedExtractionBubbleInput {
  project_id: string;
  extraction_id: string;
  title: string;
  summary: string | null;
  content: string;
  source_discussion_id: string;
  source_discussion_title: string;
  source_message_ids: string[];
  source_context_item_ids: string[];
}

interface NormalizedCreateExtractionBubbleInput extends NormalizedExtractionBubbleInput {
  position_x: number;
  position_y: number;
}

@Injectable()
export class BubblesService
  implements BubbleContextSourceReader, BubbleExtractionWriter
{
  constructor(
    private readonly projects: ProjectsService,
    @Inject(BUBBLE_REPOSITORY)
    private readonly bubbles: BubbleRepository,
  ) {}

  create(projectId: string, input: CreateBubbleInput): Bubble {
    this.projects.get(projectId);

    const timestamp = new Date().toISOString();
    const bubble: PersistedBubble = {
      id: randomUUID(),
      project_id: projectId,
      title: this.requiredText(input?.title, 'title'),
      summary: this.optionalSummary(input?.summary),
      content: this.requiredText(input?.content, 'content'),
      position_x: this.optionalCoordinate(input?.position_x, 'position_x'),
      position_y: this.optionalCoordinate(input?.position_y, 'position_y'),
      created_at: timestamp,
      updated_at: timestamp,
      source_kind: 'manual',
      source_discussion_id: null,
      source_discussion_title: null,
      source_discussion_deleted_at: null,
      source_message_ids: [],
      source_context_item_ids: [],
      latest_extraction_id: null,
    };

    return this.bubbles.create(bubble);
  }

  createFromDiscussionExtraction(
    input: CreateBubbleFromDiscussionExtractionInput,
  ): CreateBubbleFromDiscussionExtractionResult {
    const normalized: NormalizedCreateExtractionBubbleInput = {
      ...this.normalizeExtractionInput(input),
      position_x: this.requiredCoordinate(input.position_x, 'position_x'),
      position_y: this.requiredCoordinate(input.position_y, 'position_y'),
    };
    this.projects.get(normalized.project_id);
    const existingResolution = this.bubbles.findByLatestExtractionId(
      normalized.extraction_id,
    );

    if (existingResolution) {
      return {
        status: this.matchesExtractionCreate(existingResolution, normalized)
          ? 'replayed'
          : 'extraction_conflict',
        bubble: existingResolution,
      };
    }

    const timestamp = new Date().toISOString();
    const bubble: PersistedBubble = {
      id: randomUUID(),
      project_id: normalized.project_id,
      title: normalized.title,
      summary: normalized.summary,
      content: normalized.content,
      position_x: normalized.position_x,
      position_y: normalized.position_y,
      created_at: timestamp,
      updated_at: timestamp,
      source_kind: 'discussion',
      source_discussion_id: normalized.source_discussion_id,
      source_discussion_title: normalized.source_discussion_title,
      source_discussion_deleted_at: null,
      source_message_ids: normalized.source_message_ids,
      source_context_item_ids: normalized.source_context_item_ids,
      latest_extraction_id: normalized.extraction_id,
    };

    return { status: 'created', bubble: this.bubbles.create(bubble) };
  }

  updateFromDiscussionExtraction(
    input: UpdateBubbleFromDiscussionExtractionInput,
  ): UpdateBubbleFromDiscussionExtractionResult {
    const normalized = this.normalizeExtractionInput(input);
    this.projects.get(normalized.project_id);
    const bubbleId = this.requiredIdentifier(input.bubble_id, 'bubble_id');
    const expectedUpdatedAt = this.requiredIdentifier(
      input.expected_updated_at,
      'expected_updated_at',
    );
    const existingResolution = this.bubbles.findByLatestExtractionId(
      normalized.extraction_id,
    );

    if (existingResolution) {
      return {
        status:
          existingResolution.id === bubbleId &&
          this.matchesExtractionContent(existingResolution, normalized)
            ? 'replayed'
            : 'extraction_conflict',
        bubble: existingResolution,
      };
    }

    const target = this.bubbles.findByProjectAndId(
      normalized.project_id,
      bubbleId,
    );

    if (!target) {
      return { status: 'target_missing' };
    }

    if (target.updated_at !== expectedUpdatedAt) {
      return { status: 'target_changed', bubble: target };
    }

    const updated = this.bubbles.updateFromDiscussionExtraction(
      normalized.project_id,
      bubbleId,
      expectedUpdatedAt,
      {
        title: normalized.title,
        summary: normalized.summary,
        content: normalized.content,
        updated_at: this.nextTimestamp(target.updated_at),
        source_kind: 'discussion',
        source_discussion_id: normalized.source_discussion_id,
        source_discussion_title: normalized.source_discussion_title,
        source_discussion_deleted_at: null,
        source_message_ids: normalized.source_message_ids,
        source_context_item_ids: normalized.source_context_item_ids,
        latest_extraction_id: normalized.extraction_id,
      },
    );

    return updated
      ? { status: 'updated', bubble: updated }
      : {
          status: 'target_changed',
          bubble:
            this.bubbles.findByProjectAndId(normalized.project_id, bubbleId) ??
            target,
        };
  }

  list(projectId: string): Bubble[] {
    this.projects.get(projectId);
    return this.bubbles.findAllByProjectId(projectId);
  }

  get(projectId: string, bubbleId: string): Bubble {
    this.projects.get(projectId);

    const bubble = this.bubbles.findByProjectAndId(projectId, bubbleId);

    if (!bubble) {
      throw this.notFound(projectId, bubbleId);
    }

    return bubble;
  }

  readContextSource(
    projectId: string,
    bubbleId: string,
  ): BubbleContextSourceReadResult {
    const sourceProjectId = this.bubbles.findProjectIdById(bubbleId);

    if (!sourceProjectId) {
      return { status: 'unavailable', reason: 'missing' };
    }

    if (sourceProjectId !== projectId) {
      return { status: 'unavailable', reason: 'cross_project' };
    }

    const bubble = this.bubbles.findByProjectAndId(projectId, bubbleId);

    if (!bubble) {
      return { status: 'unavailable', reason: 'missing' };
    }

    return {
      status: 'available',
      source: {
        id: bubble.id,
        project_id: bubble.project_id,
        title: bubble.title,
        content: bubble.content,
      },
    };
  }

  update(
    projectId: string,
    bubbleId: string,
    input: UpdateBubbleInput,
  ): Bubble {
    const existingBubble = this.get(projectId, bubbleId);
    const hasTitle = this.hasOwn(input, 'title');
    const hasSummary = this.hasOwn(input, 'summary');
    const hasContent = this.hasOwn(input, 'content');

    if (!hasTitle && !hasSummary && !hasContent) {
      throw this.validationError({
        content: 'At least one content field must be provided.',
      });
    }

    const updatedBubble = this.bubbles.updateContent(projectId, bubbleId, {
      title: hasTitle
        ? this.requiredText(input.title, 'title')
        : existingBubble.title,
      summary: hasSummary
        ? this.optionalSummary(input.summary)
        : existingBubble.summary,
      content: hasContent
        ? this.requiredText(input.content, 'content')
        : existingBubble.content,
      updated_at: this.nextTimestamp(existingBubble.updated_at),
    });

    if (!updatedBubble) {
      throw this.notFound(projectId, bubbleId);
    }

    return updatedBubble;
  }

  reposition(
    projectId: string,
    bubbleId: string,
    input: RepositionBubbleInput,
  ): Bubble {
    this.get(projectId, bubbleId);

    const positionX = this.requiredCoordinate(input?.position_x, 'position_x');
    const positionY = this.requiredCoordinate(input?.position_y, 'position_y');
    const updatedBubble = this.bubbles.updatePosition(
      projectId,
      bubbleId,
      positionX,
      positionY,
    );

    if (!updatedBubble) {
      throw this.notFound(projectId, bubbleId);
    }

    return updatedBubble;
  }

  repositionMany(
    projectId: string,
    input: BatchRepositionBubblesInput,
  ): Bubble[] {
    this.projects.get(projectId);

    if (!Array.isArray(input?.positions) || input.positions.length === 0) {
      throw this.validationError({
        positions: 'At least one bubble position must be provided.',
      });
    }

    const bubbleIds = new Set<string>();
    const positions: BubblePositionUpdate[] = input.positions.map(
      (position, index) => {
        const bubbleId = position?.bubble_id;

        if (typeof bubbleId !== 'string' || bubbleId.trim().length === 0) {
          throw this.validationError({
            [`positions.${index}.bubble_id`]: 'Bubble identifier is required.',
          });
        }

        if (bubbleIds.has(bubbleId)) {
          throw this.validationError({
            [`positions.${index}.bubble_id`]:
              'Each bubble may only appear once.',
          });
        }

        bubbleIds.add(bubbleId);

        return {
          bubble_id: bubbleId,
          position_x: this.requiredCoordinate(
            position.position_x,
            'position_x',
          ),
          position_y: this.requiredCoordinate(
            position.position_y,
            'position_y',
          ),
        };
      },
    );

    for (const position of positions) {
      if (!this.bubbles.findByProjectAndId(projectId, position.bubble_id)) {
        throw this.notFound(projectId, position.bubble_id);
      }
    }

    return this.bubbles.updatePositions(projectId, positions);
  }

  delete(projectId: string, bubbleId: string): void {
    this.get(projectId, bubbleId);

    if (!this.bubbles.delete(projectId, bubbleId)) {
      throw this.notFound(projectId, bubbleId);
    }
  }

  private requiredText(value: unknown, field: BubbleTextField): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.validationError({
        [field]: `${field === 'title' ? 'Title' : 'Content'} is required.`,
      });
    }

    return value.trim();
  }

  private optionalSummary(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw this.validationError({ summary: 'Summary must be text.' });
    }

    return value.trim().length === 0 ? null : value.trim();
  }

  private optionalCoordinate(
    value: unknown,
    field: BubblePositionField,
  ): number {
    return value === undefined ? 0 : this.requiredCoordinate(value, field);
  }

  private requiredCoordinate(
    value: unknown,
    field: BubblePositionField,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.validationError({
        [field]: `${field === 'position_x' ? 'Horizontal' : 'Vertical'} position must be a finite number.`,
      });
    }

    return value;
  }

  private normalizeExtractionInput(
    input:
      | CreateBubbleFromDiscussionExtractionInput
      | UpdateBubbleFromDiscussionExtractionInput,
  ): NormalizedExtractionBubbleInput {
    const sourceMessageIds = this.identifierList(
      input.source_message_ids,
      'source_message_ids',
    );
    const sourceContextItemIds = this.identifierList(
      input.source_context_item_ids,
      'source_context_item_ids',
    );

    if (sourceMessageIds.length + sourceContextItemIds.length === 0) {
      throw this.validationError({
        source_message_ids:
          'At least one source message or context item is required.',
      });
    }

    return {
      project_id: this.requiredIdentifier(input.project_id, 'project_id'),
      extraction_id: this.requiredIdentifier(
        input.extraction_id,
        'extraction_id',
      ),
      title: this.requiredText(input.title, 'title'),
      summary: this.optionalSummary(input.summary),
      content: this.requiredText(input.content, 'content'),
      source_discussion_id: this.requiredIdentifier(
        input.source_discussion_id,
        'source_discussion_id',
      ),
      source_discussion_title: this.requiredIdentifier(
        input.source_discussion_title,
        'source_discussion_title',
      ),
      source_message_ids: sourceMessageIds,
      source_context_item_ids: sourceContextItemIds,
    };
  }

  private identifierList(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) {
      throw this.validationError({
        [field]: 'Source identifiers are required.',
      });
    }

    const identifiers = value.map((identifier) =>
      this.requiredIdentifier(identifier, field),
    );

    if (new Set(identifiers).size !== identifiers.length) {
      throw this.validationError({
        [field]: 'Source identifiers must be unique.',
      });
    }

    return identifiers;
  }

  private requiredIdentifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.validationError({ [field]: `${field} is required.` });
    }

    return value.trim();
  }

  private matchesExtractionCreate(
    bubble: Bubble,
    input: NormalizedCreateExtractionBubbleInput,
  ): boolean {
    return (
      this.matchesExtractionContent(bubble, input) &&
      bubble.position_x === input.position_x &&
      bubble.position_y === input.position_y
    );
  }

  private matchesExtractionContent(
    bubble: Bubble,
    input: NormalizedExtractionBubbleInput,
  ): boolean {
    return (
      bubble.project_id === input.project_id &&
      bubble.title === input.title &&
      bubble.summary === input.summary &&
      bubble.content === input.content &&
      bubble.source_kind === 'discussion' &&
      bubble.source_discussion_id === input.source_discussion_id &&
      bubble.source_discussion_title === input.source_discussion_title &&
      this.sameIdentifiers(
        bubble.source_message_ids,
        input.source_message_ids,
      ) &&
      this.sameIdentifiers(
        bubble.source_context_item_ids,
        input.source_context_item_ids,
      )
    );
  }

  private sameIdentifiers(first: string[], second: string[]): boolean {
    return (
      first.length === second.length &&
      first.every((identifier, index) => identifier === second[index])
    );
  }

  private hasOwn(input: unknown, field: keyof UpdateBubbleInput): boolean {
    return (
      typeof input === 'object' &&
      input !== null &&
      Object.prototype.hasOwnProperty.call(input, field)
    );
  }

  private nextTimestamp(previousTimestamp: string): string {
    const currentTime = Date.now();
    const previousTime = new Date(previousTimestamp).getTime();

    return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
  }

  private validationError(
    fieldErrors: Record<string, string>,
  ): BadRequestException {
    return new BadRequestException({
      code: 'BUBBLE_VALIDATION_FAILED',
      message: 'Bubble input is invalid.',
      field_errors: fieldErrors,
    });
  }

  private notFound(projectId: string, bubbleId: string): NotFoundException {
    return new NotFoundException({
      code: 'BUBBLE_NOT_FOUND',
      message: `Bubble "${bubbleId}" was not found in project "${projectId}".`,
    });
  }
}
