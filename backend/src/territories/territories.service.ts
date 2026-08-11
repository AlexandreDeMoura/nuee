import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  TERRITORY_VISIBLE_COUNT_MAX,
  TERRITORY_VISIBLE_COUNT_MIN,
  TERRITORY_TITLE_MAX_LENGTH,
} from '@nuee/shared-types';
import { ProjectsService } from '../projects/projects.service';
import {
  TERRITORY_REPOSITORY,
  UNGROUPED_TERRITORY_KIND,
  UNGROUPED_TERRITORY_TITLE,
} from './territory.types';
import type {
  BatchRepositionTerritoriesInput,
  CreateTerritoryInput,
  PersistedTerritoryPosition,
  RenameTerritoryInput,
  RepositionTerritoryInput,
  Territory,
  TerritoryBubbleLifecycle,
  TerritoryRepository,
  UpdateTerritoryVisibleCountInput,
} from './territory.types';

type CoordinateField = 'position_x' | 'position_y';
const DEFAULT_MANUAL_TERRITORY_VISIBLE_COUNT = 4;

@Injectable()
export class TerritoriesService implements TerritoryBubbleLifecycle {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(TERRITORY_REPOSITORY)
    private readonly territories: TerritoryRepository,
  ) {}

  create(projectId: string, input: CreateTerritoryInput): Territory {
    this.projects.get(projectId);
    const timestamp = new Date().toISOString();

    return this.territories.create({
      id: randomUUID(),
      project_id: projectId,
      kind: 'manual',
      title: this.requiredTitle(input?.title),
      position_x: this.requiredCoordinate(input?.position_x, 'position_x'),
      position_y: this.requiredCoordinate(input?.position_y, 'position_y'),
      visible_count: DEFAULT_MANUAL_TERRITORY_VISIBLE_COUNT,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  list(projectId: string): Territory[] {
    this.projects.get(projectId);
    return this.territories.findAllByProjectId(projectId);
  }

  rename(
    projectId: string,
    territoryId: string,
    input: RenameTerritoryInput,
  ): Territory {
    const territory = this.getManual(projectId, territoryId);
    const updated = this.territories.updateTitle(
      projectId,
      territoryId,
      this.requiredTitle(input?.title),
      this.nextTimestamp(territory.updated_at),
    );

    if (!updated) {
      throw this.notFound(projectId, territoryId);
    }

    return updated;
  }

  ensureUngrouped(projectId: string): Territory {
    const existing = this.territories.findUngroupedByProjectId(projectId);

    if (existing) {
      return existing;
    }

    const timestamp = new Date().toISOString();

    return this.territories.create({
      id: randomUUID(),
      project_id: projectId,
      kind: UNGROUPED_TERRITORY_KIND,
      title: UNGROUPED_TERRITORY_TITLE,
      position_x: 0,
      position_y: 0,
      visible_count: TERRITORY_VISIBLE_COUNT_MIN,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  updateVisibleCount(
    projectId: string,
    territoryId: string,
    input: UpdateTerritoryVisibleCountInput,
  ): Territory {
    const territory = this.get(projectId, territoryId);
    const requested = input?.visible_count;

    if (!Number.isInteger(requested)) {
      throw this.validationError({
        visible_count: 'Visible count must be an integer.',
      });
    }

    const total = this.territories.countBubbles(projectId, territoryId);
    const visibleCount = Math.min(
      Math.max(requested, TERRITORY_VISIBLE_COUNT_MIN),
      TERRITORY_VISIBLE_COUNT_MAX,
      Math.max(total, TERRITORY_VISIBLE_COUNT_MIN),
    );
    const updated = this.territories.updateVisibleCount(
      projectId,
      territoryId,
      visibleCount,
      this.nextTimestamp(territory.updated_at),
    );

    if (!updated) {
      throw this.notFound(projectId, territoryId);
    }

    return updated;
  }

  reposition(
    projectId: string,
    territoryId: string,
    input: RepositionTerritoryInput,
  ): Territory {
    const territory = this.get(projectId, territoryId);
    const updated = this.territories.updatePosition(
      projectId,
      territoryId,
      this.requiredCoordinate(input?.position_x, 'position_x'),
      this.requiredCoordinate(input?.position_y, 'position_y'),
      this.nextTimestamp(territory.updated_at),
    );

    if (!updated) {
      throw this.notFound(projectId, territoryId);
    }

    return updated;
  }

  repositionMany(
    projectId: string,
    input: BatchRepositionTerritoriesInput,
  ): Territory[] {
    this.projects.get(projectId);

    if (!Array.isArray(input?.positions) || input.positions.length === 0) {
      throw this.validationError({
        positions: 'At least one territory position must be provided.',
      });
    }

    const territoryIds = new Set<string>();
    const positions: PersistedTerritoryPosition[] = input.positions.map(
      (position, index) => {
        const territoryId = position?.territory_id;

        if (
          typeof territoryId !== 'string' ||
          territoryId.trim().length === 0
        ) {
          throw this.validationError({
            [`positions.${index}.territory_id`]:
              'Territory identifier is required.',
          });
        }

        if (territoryIds.has(territoryId)) {
          throw this.validationError({
            [`positions.${index}.territory_id`]:
              'Each territory may only appear once.',
          });
        }

        const territory = this.get(projectId, territoryId);
        territoryIds.add(territoryId);

        return {
          territory_id: territoryId,
          position_x: this.requiredCoordinate(
            position.position_x,
            'position_x',
          ),
          position_y: this.requiredCoordinate(
            position.position_y,
            'position_y',
          ),
          updated_at: this.nextTimestamp(territory.updated_at),
        };
      },
    );

    return this.territories.updatePositions(projectId, positions);
  }

  reconcileAfterBubbleDeletion(projectId: string, territoryId: string): void {
    const territory = this.territories.findByProjectAndId(
      projectId,
      territoryId,
    );

    if (!territory) {
      return;
    }

    const total = this.territories.countBubbles(projectId, territoryId);
    const clamped = Math.max(
      TERRITORY_VISIBLE_COUNT_MIN,
      Math.min(territory.visible_count, total),
    );

    if (clamped !== territory.visible_count) {
      this.territories.updateVisibleCount(
        projectId,
        territoryId,
        clamped,
        this.nextTimestamp(territory.updated_at),
      );
    }
  }

  getManual(projectId: string, territoryId: string): Territory {
    const territory = this.get(projectId, territoryId);

    if (territory.kind === 'ungrouped') {
      throw new BadRequestException({
        code: 'TERRITORY_UNGROUPED_IMMUTABLE',
        message: 'Ungrouped cannot be renamed or deleted.',
      });
    }

    return territory;
  }

  private get(projectId: string, territoryId: string): Territory {
    this.projects.get(projectId);
    const territory = this.territories.findByProjectAndId(
      projectId,
      territoryId,
    );

    if (!territory) {
      throw this.notFound(projectId, territoryId);
    }

    return territory;
  }

  private requiredTitle(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.validationError({ title: 'Title is required.' });
    }

    const title = value.trim();

    if (title.length > TERRITORY_TITLE_MAX_LENGTH) {
      throw this.validationError({
        title: `Title must be ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`,
      });
    }

    return title;
  }

  private requiredCoordinate(value: unknown, field: CoordinateField): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.validationError({
        [field]: `${field === 'position_x' ? 'Horizontal' : 'Vertical'} position must be a finite number.`,
      });
    }

    return value;
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
      code: 'TERRITORY_VALIDATION_FAILED',
      message: 'Territory input is invalid.',
      field_errors: fieldErrors,
    });
  }

  private notFound(projectId: string, territoryId: string): NotFoundException {
    return new NotFoundException({
      code: 'TERRITORY_NOT_FOUND',
      message: `Territory "${territoryId}" was not found in project "${projectId}".`,
    });
  }
}
