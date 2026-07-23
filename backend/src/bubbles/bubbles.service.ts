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
  BubblePositionUpdate,
  BubbleRepository,
  CreateBubbleInput,
  RepositionBubbleInput,
  UpdateBubbleInput,
} from './bubble.types';

type BubbleTextField = 'title' | 'content';
type BubblePositionField = 'position_x' | 'position_y';

@Injectable()
export class BubblesService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(BUBBLE_REPOSITORY)
    private readonly bubbles: BubbleRepository,
  ) {}

  create(projectId: string, input: CreateBubbleInput): Bubble {
    this.projects.get(projectId);

    const timestamp = new Date().toISOString();
    const bubble: Bubble = {
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
      source_message_ids: [],
    };

    return this.bubbles.create(bubble);
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
