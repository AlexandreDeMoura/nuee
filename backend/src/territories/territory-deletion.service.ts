import { Inject, Injectable } from '@nestjs/common';
import {
  BUBBLE_TERRITORY_ASSIGNMENT_WRITER,
  type BubbleTerritoryAssignmentWriter,
} from '../bubbles/bubble.types';
import { DatabaseTransaction } from '../database/database-transaction';
import {
  TERRITORY_REPOSITORY,
  type DeleteTerritoryResponse,
  type TerritoryRepository,
} from './territory.types';
import { TerritoriesService } from './territories.service';

@Injectable()
export class TerritoryDeletionService {
  constructor(
    private readonly territoryLifecycle: TerritoriesService,
    @Inject(TERRITORY_REPOSITORY)
    private readonly territories: TerritoryRepository,
    @Inject(BUBBLE_TERRITORY_ASSIGNMENT_WRITER)
    private readonly bubbleWriter: BubbleTerritoryAssignmentWriter,
    private readonly transactions: DatabaseTransaction,
  ) {}

  delete(projectId: string, territoryId: string): DeleteTerritoryResponse {
    this.territoryLifecycle.getManual(projectId, territoryId);

    return this.transactions.run(() => {
      const memberCount = this.territories.countBubbles(projectId, territoryId);

      if (memberCount > 0) {
        const ungrouped = this.territoryLifecycle.ensureUngrouped(projectId);
        const movedCount = this.bubbleWriter.moveTerritoryMembers(
          projectId,
          territoryId,
          ungrouped.id,
        );

        if (movedCount !== memberCount) {
          throw new Error(
            `Territory "${territoryId}" membership changed during deletion.`,
          );
        }
      }

      if (!this.territories.delete(projectId, territoryId)) {
        throw new Error(
          `Territory "${territoryId}" was unavailable during deletion.`,
        );
      }

      return { moved_bubble_count: memberCount };
    });
  }
}
