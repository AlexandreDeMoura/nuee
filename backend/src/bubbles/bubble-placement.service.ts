import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { BUBBLE_REPOSITORY } from './bubble.types';
import type {
  Bubble,
  BubblePlacement,
  BubbleRepository,
  PlaceBubbleInput,
} from './bubble.types';

export const BUBBLE_CARD_WIDTH = 248;
export const BUBBLE_CARD_HEIGHT = 154;
export const BUBBLE_PLACEMENT_GAP = 24;

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

function overlapsExisting(candidate: Point, bubbles: Bubble[]): boolean {
  return bubbles.some(
    (bubble) =>
      candidate.x <
        bubble.position_x + BUBBLE_CARD_WIDTH + BUBBLE_PLACEMENT_GAP &&
      candidate.x + BUBBLE_CARD_WIDTH + BUBBLE_PLACEMENT_GAP >
        bubble.position_x &&
      candidate.y <
        bubble.position_y + BUBBLE_CARD_HEIGHT + BUBBLE_PLACEMENT_GAP &&
      candidate.y + BUBBLE_CARD_HEIGHT + BUBBLE_PLACEMENT_GAP >
        bubble.position_y,
  );
}

function compareOffsets(first: Point, second: Point) {
  const firstDistance = first.x * first.x + first.y * first.y;
  const secondDistance = second.x * second.x + second.y * second.y;

  if (firstDistance !== secondDistance) {
    return firstDistance - secondDistance;
  }

  const angle = ({ x, y }: Point) => {
    const value = Math.atan2(y, x);
    return value < 0 ? value + Math.PI * 2 : value;
  };

  return angle(first) - angle(second);
}

function ringOffsets(radius: number): Point[] {
  if (radius === 0) {
    return [{ x: 0, y: 0 }];
  }

  const offsets: Point[] = [];

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) === radius) {
        offsets.push({ x, y });
      }
    }
  }

  return offsets.sort(compareOffsets);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function findCandidate(anchor: Point, bubbles: Bubble[], bounds?: Bounds) {
  const stepX = BUBBLE_CARD_WIDTH + BUBBLE_PLACEMENT_GAP;
  const stepY = BUBBLE_CARD_HEIGHT + BUBBLE_PLACEMENT_GAP;
  const horizontalSlots = bounds ? Math.ceil(bounds.width / stepX) : 0;
  const verticalSlots = bounds ? Math.ceil(bounds.height / stepY) : 0;
  const limit = bounds
    ? Math.max(horizontalSlots, verticalSlots) + 1
    : bubbles.length + 1;
  const seen = new Set<string>();

  for (let radius = 0; radius <= limit; radius += 1) {
    for (const offset of ringOffsets(radius)) {
      let x = anchor.x + offset.x * stepX;
      let y = anchor.y + offset.y * stepY;

      if (bounds) {
        const maximumX = bounds.x + bounds.width - BUBBLE_CARD_WIDTH;
        const maximumY = bounds.y + bounds.height - BUBBLE_CARD_HEIGHT;

        if (maximumX >= bounds.x) {
          x = clamp(x, bounds.x, maximumX);
        }

        if (maximumY >= bounds.y) {
          y = clamp(y, bounds.y, maximumY);
        }
      }

      const candidate = { x, y };
      const key = `${candidate.x}:${candidate.y}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (!overlapsExisting(candidate, bubbles)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function findAvailableBubblePosition(
  anchor: Point,
  bubbles: Bubble[],
  bounds?: Bounds,
): BubblePlacement {
  const boundedCandidate = findCandidate(anchor, bubbles, bounds);

  if (boundedCandidate) {
    return {
      position_x: boundedCandidate.x,
      position_y: boundedCandidate.y,
    };
  }

  const unboundedCandidate = findCandidate(anchor, bubbles);

  return {
    position_x: unboundedCandidate?.x ?? anchor.x,
    position_y: unboundedCandidate?.y ?? anchor.y,
  };
}

@Injectable()
export class BubblePlacementService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(BUBBLE_REPOSITORY)
    private readonly bubbles: BubbleRepository,
  ) {}

  place(projectId: string, input: PlaceBubbleInput): BubblePlacement {
    this.projects.get(projectId);
    const existingBubbles = this.bubbles.findAllByProjectId(projectId);

    if (input?.strategy === 'cluster') {
      return this.placeNearCluster(existingBubbles);
    }

    if (input?.strategy !== 'viewport') {
      throw this.validationError({
        strategy: 'Placement strategy must be viewport or cluster.',
      });
    }

    const bounds = {
      x: this.requiredFiniteNumber(input.viewport_x, 'viewport_x'),
      y: this.requiredFiniteNumber(input.viewport_y, 'viewport_y'),
      width: this.requiredPositiveNumber(
        input.viewport_width,
        'viewport_width',
      ),
      height: this.requiredPositiveNumber(
        input.viewport_height,
        'viewport_height',
      ),
    };
    const anchor = {
      x: bounds.x + (bounds.width - BUBBLE_CARD_WIDTH) / 2,
      y: bounds.y + (bounds.height - BUBBLE_CARD_HEIGHT) / 2,
    };

    return findAvailableBubblePosition(anchor, existingBubbles, bounds);
  }

  private placeNearCluster(bubbles: Bubble[]): BubblePlacement {
    if (bubbles.length === 0) {
      return { position_x: 0, position_y: 0 };
    }

    const minimumX = Math.min(...bubbles.map((bubble) => bubble.position_x));
    const maximumX = Math.max(
      ...bubbles.map((bubble) => bubble.position_x + BUBBLE_CARD_WIDTH),
    );
    const minimumY = Math.min(...bubbles.map((bubble) => bubble.position_y));
    const maximumY = Math.max(
      ...bubbles.map((bubble) => bubble.position_y + BUBBLE_CARD_HEIGHT),
    );
    const anchor = {
      x: (minimumX + maximumX - BUBBLE_CARD_WIDTH) / 2,
      y: (minimumY + maximumY - BUBBLE_CARD_HEIGHT) / 2,
    };

    return findAvailableBubblePosition(anchor, bubbles);
  }

  private requiredFiniteNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.validationError({
        [field]: `${field} must be a finite number.`,
      });
    }

    return value;
  }

  private requiredPositiveNumber(value: unknown, field: string): number {
    const number = this.requiredFiniteNumber(value, field);

    if (number <= 0) {
      throw this.validationError({
        [field]: `${field} must be greater than zero.`,
      });
    }

    return number;
  }

  private validationError(
    fieldErrors: Record<string, string>,
  ): BadRequestException {
    return new BadRequestException({
      code: 'BUBBLE_PLACEMENT_VALIDATION_FAILED',
      message: 'Bubble placement input is invalid.',
      field_errors: fieldErrors,
    });
  }
}
