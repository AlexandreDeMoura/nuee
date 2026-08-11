import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  RECOMPOSE_TERRITORY_COUNT_MAX,
  RECOMPOSE_TERRITORY_COUNT_MIN,
  TERRITORY_TITLE_MAX_LENGTH,
  type RecomposeTerritoriesResponse,
} from '@nuee/shared-types';
import {
  MODEL_CLIENT,
  ModelGenerationError,
  type ModelClient,
} from '../ai/model-client';
import {
  MODEL_INPUT_BUDGET,
  type ModelInputBudget,
} from '../ai/model-input-budget';
import {
  BUBBLE_TERRITORY_ASSIGNMENT_WRITER,
  BUBBLE_TERRITORY_COMPOSITION_READER,
  type BubbleTerritoryAssignment,
  type BubbleTerritoryAssignmentWriter,
  type BubbleTerritoryCompositionReader,
} from '../bubbles/bubble.types';
import { DatabaseTransaction } from '../database/database-transaction';
import { ProjectsService } from '../projects/projects.service';
import { buildTerritoryRecompositionModelInput } from './territory-recomposition.prompt';
import {
  TERRITORY_REPOSITORY,
  type TerritoryRepository,
} from './territory.types';

const DEFAULT_VISIBLE_COUNT = 4;
const DEFAULT_TERRITORY_HORIZONTAL_GAP = 360;

interface TerritoryProposal {
  title: string;
  bubbleIds: string[];
}

type RecompositionFailureReason =
  | 'provider'
  | 'timeout'
  | 'invalid_request'
  | 'invalid_response'
  | 'invalid_output'
  | 'persistence';

@Injectable()
export class TerritoryRecompositionService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(TERRITORY_REPOSITORY)
    private readonly territories: TerritoryRepository,
    @Inject(BUBBLE_TERRITORY_COMPOSITION_READER)
    private readonly bubbleReader: BubbleTerritoryCompositionReader,
    @Inject(BUBBLE_TERRITORY_ASSIGNMENT_WRITER)
    private readonly bubbleWriter: BubbleTerritoryAssignmentWriter,
    @Inject(MODEL_CLIENT)
    private readonly modelClient: ModelClient,
    @Inject(MODEL_INPUT_BUDGET)
    private readonly modelInputBudget: ModelInputBudget,
    private readonly transactions: DatabaseTransaction,
  ) {}

  async recompose(
    projectId: string,
    input: unknown,
  ): Promise<RecomposeTerritoriesResponse> {
    this.projects.get(projectId);
    this.validateInput(input);
    const bubbles = this.bubbleReader.listForTerritoryComposition(projectId);

    if (bubbles.length < 2) {
      throw new BadRequestException({
        code: 'TERRITORY_RECOMPOSE_REQUIRES_TWO_BUBBLES',
        message: 'At least two bubbles are required to recompose territories.',
      });
    }

    const modelInput = buildTerritoryRecompositionModelInput(bubbles);
    const budget = this.modelInputBudget.evaluateStructuredOutput(modelInput);

    if (!budget.fits) {
      throw new PayloadTooLargeException({
        code: 'TERRITORY_RECOMPOSE_SOURCE_TOO_LARGE',
        message:
          'The project bubbles exceed the supported model input budget for territory recomposition.',
        estimated_input_tokens: budget.estimatedInputTokens,
        available_input_tokens: budget.availableInputTokens,
        input_token_limit: budget.inputTokenLimit,
        reserved_output_tokens: budget.reservedOutputTokens,
        safety_margin_tokens: budget.safetyMarginTokens,
      });
    }

    let output: unknown;

    try {
      output = (await this.modelClient.generateStructuredOutput(modelInput))
        .output;
    } catch (error) {
      const reason =
        error instanceof ModelGenerationError ? error.reason : 'provider';
      throw this.recompositionFailed(reason);
    }

    let proposals: TerritoryProposal[];

    try {
      proposals = this.normalizeProposals(
        output,
        bubbles.map(({ id }) => id),
      );
    } catch {
      throw this.recompositionFailed('invalid_output');
    }

    try {
      return this.persistReplacement(projectId, proposals);
    } catch {
      throw this.recompositionFailed('persistence');
    }
  }

  private persistReplacement(
    projectId: string,
    proposals: TerritoryProposal[],
  ): RecomposeTerritoriesResponse {
    return this.transactions.run(() => {
      const existing = this.territories.findAllByProjectId(projectId);
      const predecessors = existing.filter(({ kind }) => kind === 'composed');
      const anchor = predecessors[0] ?? existing[0];
      const timestamp = new Date().toISOString();
      const assignments: BubbleTerritoryAssignment[] = [];

      proposals.forEach((proposal, index) => {
        const previousPosition = predecessors[index];
        const territoryId = randomUUID();

        this.territories.create({
          id: territoryId,
          project_id: projectId,
          kind: 'composed',
          title: proposal.title,
          position_x:
            previousPosition?.position_x ??
            (anchor?.position_x ?? 0) +
              index * DEFAULT_TERRITORY_HORIZONTAL_GAP,
          position_y: previousPosition?.position_y ?? anchor?.position_y ?? 0,
          visible_count: Math.min(
            DEFAULT_VISIBLE_COUNT,
            proposal.bubbleIds.length,
          ),
          created_at: timestamp,
          updated_at: timestamp,
        });

        assignments.push(
          ...proposal.bubbleIds.map((bubbleId) => ({
            bubble_id: bubbleId,
            territory_id: territoryId,
          })),
        );
      });

      this.bubbleWriter.assignTerritories(projectId, assignments);
      this.territories.deleteComposedByIds(
        projectId,
        predecessors.map(({ id }) => id),
      );

      return {
        territories: this.territories.findAllByProjectId(projectId),
        bubbles: this.bubbleReader.listForTerritoryComposition(projectId),
      };
    });
  }

  private normalizeProposals(
    output: unknown,
    expectedBubbleIds: string[],
  ): TerritoryProposal[] {
    if (
      !this.isRecord(output) ||
      Object.keys(output).length !== 1 ||
      !Array.isArray(output.territories) ||
      output.territories.length < RECOMPOSE_TERRITORY_COUNT_MIN ||
      output.territories.length > RECOMPOSE_TERRITORY_COUNT_MAX ||
      output.territories.length > expectedBubbleIds.length
    ) {
      throw new Error('The model returned an invalid territory composition.');
    }

    const expectedIds = new Set(expectedBubbleIds);
    const assignedIds = new Set<string>();
    const proposals = output.territories.map((value) => {
      if (
        !this.isRecord(value) ||
        Object.keys(value).length !== 2 ||
        !Object.keys(value).every((key) =>
          ['title', 'bubble_ids'].includes(key),
        ) ||
        !Array.isArray(value.bubble_ids) ||
        value.bubble_ids.length === 0
      ) {
        throw new Error('The model returned an invalid territory.');
      }

      const title = this.normalizedTitle(value.title);
      const bubbleIds = value.bubble_ids;

      if (!title) {
        throw new Error('The model returned an invalid territory title.');
      }

      for (const bubbleId of bubbleIds) {
        if (
          typeof bubbleId !== 'string' ||
          !expectedIds.has(bubbleId) ||
          assignedIds.has(bubbleId)
        ) {
          throw new Error('The model returned an invalid bubble assignment.');
        }

        assignedIds.add(bubbleId);
      }

      return { title, bubbleIds: bubbleIds as string[] };
    });

    if (
      assignedIds.size !== expectedIds.size ||
      expectedBubbleIds.some((bubbleId) => !assignedIds.has(bubbleId))
    ) {
      throw new Error('The model omitted one or more bubbles.');
    }

    return proposals;
  }

  private validateInput(input: unknown): void {
    if (!this.isRecord(input) || Object.keys(input).length !== 0) {
      throw new BadRequestException({
        code: 'TERRITORY_RECOMPOSE_INPUT_INVALID',
        message: 'Territory recomposition does not accept options.',
      });
    }
  }

  private normalizedTitle(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length <= TERRITORY_TITLE_MAX_LENGTH ? normalized : '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private recompositionFailed(
    reason: RecompositionFailureReason,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'TERRITORY_RECOMPOSE_FAILED',
      message: 'Territories could not be recomposed. Try again.',
      reason,
    });
  }
}
