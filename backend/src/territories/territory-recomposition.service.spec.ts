import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { StructuredModelGeneration } from '../ai/model-client';
import { ModelGenerationError, type ModelClient } from '../ai/model-client';
import type {
  ModelInputBudget,
  ModelInputBudgetResult,
} from '../ai/model-input-budget';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import type { BubbleTerritoryAssignmentWriter } from '../bubbles/bubble.types';
import { DatabaseTransaction } from '../database/database-transaction';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from './sqlite-territory.repository';
import { TerritoriesService } from './territories.service';
import { TerritoryRecompositionService } from './territory-recomposition.service';

const FITTING_BUDGET: ModelInputBudgetResult = {
  fits: true,
  estimatedInputTokens: 500,
  availableInputTokens: 10_000,
  inputTokenLimit: 15_000,
  reservedOutputTokens: 3_000,
  safetyMarginTokens: 2_000,
};

describe('TerritoryRecompositionService', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let territoryRepository: SqliteTerritoryRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let bubbles: BubblesService;
  let generateStructuredOutput: jest.MockedFunction<
    ModelClient['generateStructuredOutput']
  >;
  let modelClient: ModelClient;
  let modelInputBudget: ModelInputBudget;
  let evaluateStructuredOutput: jest.MockedFunction<
    ModelInputBudget['evaluateStructuredOutput']
  >;
  let service: TerritoryRecompositionService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T09:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    territoryRepository = new SqliteTerritoryRepository(databaseProvider);
    bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    const transactions = new DatabaseTransaction(databaseProvider);
    const territoryLifecycle = new TerritoriesService(
      projects,
      territoryRepository,
    );
    bubbles = new BubblesService(
      projects,
      bubbleRepository,
      territoryLifecycle,
      transactions,
    );
    generateStructuredOutput = jest.fn();
    modelClient = {
      generateAnswer: jest.fn(),
      generateTitle: jest.fn(),
      generateStructuredOutput,
    };
    evaluateStructuredOutput = jest.fn(() => FITTING_BUDGET);
    modelInputBudget = {
      evaluateAnswer: jest.fn(() => FITTING_BUDGET),
      evaluateStructuredOutput,
    };
    service = new TerritoryRecompositionService(
      projects,
      territoryRepository,
      bubbles,
      bubbles,
      modelClient,
      modelInputBudget,
      transactions,
    );
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createProjectWithBubbles(count: number) {
    const project = projects.create({
      title: 'Composition project',
      description: 'Knowledge to organize.',
    });
    const created = Array.from({ length: count }, (_, index) =>
      bubbles.create(project.id, {
        title: `Bubble ${index + 1}`,
        summary: `Summary ${index + 1}`,
        content: `Content ${index + 1}`,
      }),
    );

    return { project, created };
  }

  function generation(output: unknown): StructuredModelGeneration {
    return { output, model: 'controlled-model' };
  }

  it('atomically replaces composed territories and assigns every bubble once', async () => {
    const { project, created } = createProjectWithBubbles(5);
    const predecessor = territoryRepository.create({
      id: 'old-composed',
      project_id: project.id,
      kind: 'composed',
      title: 'Old composition',
      position_x: 120,
      position_y: -40,
      visible_count: 5,
      created_at: '2026-08-10T08:00:00.000Z',
      updated_at: '2026-08-10T08:00:00.000Z',
    });
    bubbles.assignTerritories(
      project.id,
      created.map(({ id }) => ({
        bubble_id: id,
        territory_id: predecessor.id,
      })),
    );
    generateStructuredOutput.mockResolvedValue(
      generation({
        territories: [
          {
            title: '  Product   strategy ',
            bubble_ids: created.slice(0, 4).map(({ id }) => id),
          },
          { title: 'Operations', bubble_ids: [created[4].id] },
        ],
      }),
    );

    const result = await service.recompose(project.id, {});
    const composed = result.territories.filter(
      ({ kind }) => kind === 'composed',
    );

    expect(composed).toHaveLength(2);
    expect(composed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Product strategy',
          position_x: 120,
          position_y: -40,
          visible_count: 4,
        }),
        expect.objectContaining({ title: 'Operations', visible_count: 1 }),
      ]),
    );
    expect(result.territories).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ungrouped' })]),
    );
    expect(result.territories.map(({ id }) => id)).not.toContain(
      predecessor.id,
    );
    expect(
      new Set(result.bubbles.map(({ territory_id }) => territory_id)),
    ).toEqual(new Set(composed.map(({ id }) => id)));
    expect(result.bubbles.map(({ content }) => content).sort()).toEqual(
      created.map(({ content }) => content).sort(),
    );
    expect(evaluateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(generateStructuredOutput).toHaveBeenCalledTimes(1);
  });

  it('requires an empty request and at least two bubbles before calling the model', async () => {
    const { project } = createProjectWithBubbles(1);

    await expect(service.recompose(project.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.recompose(project.id, { instructions: 'make two groups' }),
    ).rejects.toMatchObject({
      response: { code: 'TERRITORY_RECOMPOSE_INPUT_INVALID' },
    });
    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('rejects an over-budget prompt before calling the model', async () => {
    const { project } = createProjectWithBubbles(2);
    evaluateStructuredOutput.mockReturnValue({
      ...FITTING_BUDGET,
      fits: false,
    });

    await expect(service.recompose(project.id, {})).rejects.toMatchObject({
      response: { code: 'TERRITORY_RECOMPOSE_SOURCE_TOO_LARGE' },
    });
    await expect(service.recompose(project.id, {})).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'duplicate assignment',
      output: (ids: string[]) => ({
        territories: [
          { title: 'One', bubble_ids: [ids[0], ids[1]] },
          { title: 'Two', bubble_ids: [ids[1]] },
        ],
      }),
    },
    {
      label: 'unknown identifier',
      output: (ids: string[]) => ({
        territories: [{ title: 'One', bubble_ids: [ids[0], 'unknown-bubble'] }],
      }),
    },
    {
      label: 'missing identifier',
      output: (ids: string[]) => ({
        territories: [{ title: 'One', bubble_ids: [ids[0]] }],
      }),
    },
    {
      label: 'empty title',
      output: (ids: string[]) => ({
        territories: [{ title: '   ', bubble_ids: ids }],
      }),
    },
    {
      label: 'unknown property',
      output: (ids: string[]) => ({
        territories: [{ title: 'One', bubble_ids: ids, description: 'extra' }],
      }),
    },
  ])('leaves territories unchanged for $label', async ({ output }) => {
    const { project, created } = createProjectWithBubbles(2);
    const beforeTerritories = territoryRepository.findAllByProjectId(
      project.id,
    );
    const beforeBubbles = bubbleRepository.findAllByProjectId(project.id);
    generateStructuredOutput.mockResolvedValue(
      generation(output(created.map(({ id }) => id))),
    );

    await expect(service.recompose(project.id, {})).rejects.toMatchObject({
      response: {
        code: 'TERRITORY_RECOMPOSE_FAILED',
        reason: 'invalid_output',
      },
    });
    expect(territoryRepository.findAllByProjectId(project.id)).toEqual(
      beforeTerritories,
    );
    expect(bubbleRepository.findAllByProjectId(project.id)).toEqual(
      beforeBubbles,
    );
  });

  it.each(['timeout', 'invalid_request'] as const)(
    'returns a stable %s reason without changing persistence',
    async (reason) => {
      const { project } = createProjectWithBubbles(2);
      const before = territoryRepository.findAllByProjectId(project.id);
      generateStructuredOutput.mockRejectedValue(
        new ModelGenerationError(reason),
      );

      await expect(service.recompose(project.id, {})).rejects.toMatchObject({
        response: {
          code: 'TERRITORY_RECOMPOSE_FAILED',
          reason,
        },
      });
      await expect(service.recompose(project.id, {})).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(territoryRepository.findAllByProjectId(project.id)).toEqual(
        before,
      );
    },
  );

  it('rolls back newly inserted territories and assignments on persistence failure', async () => {
    const { project, created } = createProjectWithBubbles(2);
    const beforeTerritories = territoryRepository.findAllByProjectId(
      project.id,
    );
    const beforeBubbles = bubbleRepository.findAllByProjectId(project.id);
    const failingWriter: BubbleTerritoryAssignmentWriter = {
      assignTerritories: (projectId, assignments) => {
        bubbleRepository.updateTerritories(projectId, assignments);
        throw new Error('Injected persistence failure.');
      },
    };
    service = new TerritoryRecompositionService(
      projects,
      territoryRepository,
      bubbles,
      failingWriter,
      modelClient,
      modelInputBudget,
      new DatabaseTransaction(databaseProvider),
    );
    generateStructuredOutput.mockResolvedValue(
      generation({
        territories: [
          {
            title: 'Valid territory',
            bubble_ids: created.map(({ id }) => id),
          },
        ],
      }),
    );

    await expect(service.recompose(project.id, {})).rejects.toMatchObject({
      response: {
        code: 'TERRITORY_RECOMPOSE_FAILED',
        reason: 'persistence',
      },
    });
    expect(territoryRepository.findAllByProjectId(project.id)).toEqual(
      beforeTerritories,
    );
    expect(bubbleRepository.findAllByProjectId(project.id)).toEqual(
      beforeBubbles,
    );
  });
});
