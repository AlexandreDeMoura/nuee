import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BUBBLE_LINK_REPOSITORY,
  type BubbleLink,
  type BubbleLinkRepository,
  type CreateBubbleLinkInput,
} from './bubble.types';
import { BubblesService } from './bubbles.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class BubbleLinksService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly bubbles: BubblesService,
    @Inject(BUBBLE_LINK_REPOSITORY)
    private readonly links: BubbleLinkRepository,
  ) {}

  list(projectId: string): BubbleLink[] {
    this.projects.get(projectId);
    return this.links.findAllLinksByProjectId(projectId);
  }

  create(projectId: string, input: CreateBubbleLinkInput): BubbleLink {
    const [bubbleAId, bubbleBId] = this.validatePair(input);

    this.bubbles.get(projectId, bubbleAId);
    this.bubbles.get(projectId, bubbleBId);

    const existingLink = this.links.findLink(projectId, bubbleAId, bubbleBId);

    if (existingLink) {
      return existingLink;
    }

    return this.links.createLink({
      id: randomUUID(),
      project_id: projectId,
      bubble_a_id: bubbleAId,
      bubble_b_id: bubbleBId,
      created_at: new Date().toISOString(),
    });
  }

  delete(
    projectId: string,
    firstBubbleId: string,
    secondBubbleId: string,
  ): void {
    const [bubbleAId, bubbleBId] = this.validatePair({
      bubble_a_id: firstBubbleId,
      bubble_b_id: secondBubbleId,
    });

    this.bubbles.get(projectId, bubbleAId);
    this.bubbles.get(projectId, bubbleBId);

    if (!this.links.deleteLink(projectId, bubbleAId, bubbleBId)) {
      throw new NotFoundException({
        code: 'BUBBLE_LINK_NOT_FOUND',
        message: `No manual link exists between bubbles "${bubbleAId}" and "${bubbleBId}" in project "${projectId}".`,
      });
    }
  }

  private validatePair(input: CreateBubbleLinkInput): [string, string] {
    const firstBubbleId = this.requiredId(input?.bubble_a_id, 'bubble_a_id');
    const secondBubbleId = this.requiredId(input?.bubble_b_id, 'bubble_b_id');

    if (firstBubbleId === secondBubbleId) {
      throw this.validationError({
        bubble_b_id: 'A bubble cannot be linked to itself.',
      });
    }

    return firstBubbleId < secondBubbleId
      ? [firstBubbleId, secondBubbleId]
      : [secondBubbleId, firstBubbleId];
  }

  private requiredId(
    value: unknown,
    field: keyof CreateBubbleLinkInput,
  ): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.validationError({
        [field]: 'A bubble identifier is required.',
      });
    }

    return value.trim();
  }

  private validationError(
    fieldErrors: Record<string, string>,
  ): BadRequestException {
    return new BadRequestException({
      code: 'BUBBLE_LINK_VALIDATION_FAILED',
      message: 'Bubble link input is invalid.',
      field_errors: fieldErrors,
    });
  }
}
