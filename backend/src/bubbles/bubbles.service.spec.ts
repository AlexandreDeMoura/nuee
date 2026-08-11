import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from '../territories/sqlite-territory.repository';
import { TerritoriesService } from '../territories/territories.service';
import type { CreateBubbleFromDiscussionExtractionInput } from './bubble.types';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblesService', () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let databaseProvider: DatabaseProvider;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let territoryRepository: SqliteTerritoryRepository;
  let projects: ProjectsService;
  let service: BubblesService;

  function openRepositories(): void {
    databaseProvider = new DatabaseProvider({ databasePath });
    projectRepository = new SqliteProjectRepository(databaseProvider);
    bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    territoryRepository = new SqliteTerritoryRepository(databaseProvider);
    projects = new ProjectsService(projectRepository);
    service = new BubblesService(
      projects,
      bubbleRepository,
      new TerritoriesService(projects, territoryRepository),
      new DatabaseTransaction(databaseProvider),
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubbles-'));
    databasePath = join(temporaryDirectory, 'bubbles.sqlite');
    openRepositories();
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
    jest.useRealTimers();
  });

  function createProject(title = 'Research') {
    return projects.create({ title, description: `${title} description` });
  }

  function extractionInput(
    projectId: string,
    overrides: Partial<CreateBubbleFromDiscussionExtractionInput> = {},
  ): CreateBubbleFromDiscussionExtractionInput {
    return {
      project_id: projectId,
      extraction_id: 'extraction-1',
      source_discussion_id: 'discussion-1',
      source_discussion_title: 'Launch tradeoffs',
      source_message_ids: ['message-1', 'message-2'],
      source_context_item_ids: ['context-1'],
      title: 'Extracted decision',
      summary: 'A reusable decision from the discussion.',
      content: 'Choose the reversible launch path while demand is uncertain.',
      ...overrides,
    };
  }

  it('creates a trimmed manual bubble with persistence defaults', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();

    const bubble = service.create(project.id, {
      title: '  Decision criteria  ',
      summary: '   ',
      content: '  Prefer reversible choices.  ',
    });

    expect(bubble.id).not.toHaveLength(0);
    expect(bubble).toEqual({
      id: bubble.id,
      project_id: project.id,
      territory_id: bubble.territory_id,
      title: 'Decision criteria',
      summary: null,
      content: 'Prefer reversible choices.',
      created_at: '2026-07-21T09:00:00.000Z',
      updated_at: '2026-07-21T09:00:00.000Z',
      source_kind: 'manual',
      source_discussion_id: null,
      source_discussion_title: null,
      source_discussion_deleted_at: null,
      source_message_ids: [],
      source_context_item_ids: [],
    });
    expect(service.list(project.id)).toEqual([bubble]);
    expect(service.get(project.id, bubble.id)).toEqual(bubble);
  });

  it('accepts an optional summary', () => {
    const project = createProject();

    const bubble = service.create(project.id, {
      title: 'Placed bubble',
      summary: '  A concise summary.  ',
      content: 'Full content',
    });

    expect(bubble).toMatchObject({
      summary: 'A concise summary.',
      territory_id: bubble.territory_id,
    });
    expect(bubble.territory_id).not.toHaveLength(0);
  });

  it('routes manual bubbles to existing and newly created destinations', () => {
    const project = createProject();
    const territories = new TerritoriesService(projects, territoryRepository);
    const existing = territories.create(project.id, {
      title: 'Existing evidence',
      position_x: -120,
      position_y: 80,
    });

    const inExisting = service.create(project.id, {
      title: 'Known destination',
      content: 'Keep this in the existing territory.',
      destination: { kind: 'existing', territory_id: existing.id },
    });
    const inNew = service.create(project.id, {
      title: 'New destination',
      content: 'Create the destination atomically.',
      destination: {
        kind: 'new',
        title: '  New decisions  ',
        position_x: 240,
        position_y: -60,
      },
    });

    expect(inExisting.territory_id).toBe(existing.id);
    expect(territories.list(project.id)).toEqual(
      expect.arrayContaining([
        existing,
        expect.objectContaining({
          id: inNew.territory_id,
          kind: 'manual',
          title: 'New decisions',
          position_x: 240,
          position_y: -60,
        }),
      ]),
    );
  });

  it('rejects invalid or cross-project destinations before bubble persistence', () => {
    const project = createProject('Owner');
    const otherProject = createProject('Other');
    const territories = new TerritoriesService(projects, territoryRepository);
    const otherTerritory = territories.create(otherProject.id, {
      title: 'Other project',
      position_x: 0,
      position_y: 0,
    });

    expect(() =>
      service.create(project.id, {
        title: 'Cross-project bubble',
        content: 'Must not be persisted.',
        destination: {
          kind: 'existing',
          territory_id: otherTerritory.id,
        },
      }),
    ).toThrow(NotFoundException);
    expect(() =>
      service.create(project.id, {
        title: 'Malformed destination',
        content: 'Must not be persisted.',
        destination: { kind: 'new', title: 'Missing coordinates' } as never,
      }),
    ).toThrow(BadRequestException);
    expect(service.list(project.id)).toEqual([]);
  });

  it('rolls back a new destination when bubble persistence fails', () => {
    const project = createProject();
    jest.spyOn(bubbleRepository, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated bubble persistence failure.');
    });

    expect(() =>
      service.create(project.id, {
        title: 'Atomic bubble',
        content: 'Neither record may survive.',
        destination: {
          kind: 'new',
          title: 'Atomic territory',
          position_x: 12,
          position_y: 34,
        },
      }),
    ).toThrow('Simulated bubble persistence failure.');
    expect(service.list(project.id)).toEqual([]);
    expect(territoryRepository.findAllByProjectId(project.id)).toEqual([]);
  });

  it('creates a discussion extraction bubble with complete frozen provenance and supports replay', () => {
    jest.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));
    const project = createProject();
    const input = extractionInput(project.id);

    const created = service.createFromDiscussionExtraction(input);

    expect(created).toEqual({
      status: 'created',
      bubble: {
        id: created.bubble.id,
        project_id: project.id,
        territory_id: created.bubble.territory_id,
        title: 'Extracted decision',
        summary: 'A reusable decision from the discussion.',
        content: 'Choose the reversible launch path while demand is uncertain.',
        created_at: '2026-07-29T09:00:00.000Z',
        updated_at: '2026-07-29T09:00:00.000Z',
        source_kind: 'discussion',
        source_discussion_id: 'discussion-1',
        source_discussion_title: 'Launch tradeoffs',
        source_discussion_deleted_at: null,
        source_message_ids: ['message-1', 'message-2'],
        source_context_item_ids: ['context-1'],
      },
    });
    expect(
      databaseProvider.connection
        .prepare('SELECT latest_extraction_id FROM bubbles WHERE id = ?')
        .get(created.bubble.id),
    ).toEqual({ latest_extraction_id: 'extraction-1' });
    expect(service.createFromDiscussionExtraction(input)).toEqual({
      status: 'replayed',
      bubble: created.bubble,
    });
    expect(
      service.createFromDiscussionExtraction({
        ...input,
        content: 'A conflicting replay.',
      }),
    ).toEqual({
      status: 'extraction_conflict',
      bubble: created.bubble,
    });
    expect(service.list(project.id)).toEqual([created.bubble]);
    expect(created.bubble).not.toHaveProperty('latest_extraction_id');
  });

  it('updates a bubble through the extraction port with optimistic concurrency and replay protection', () => {
    jest.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));
    const project = createProject();
    const original = service.create(project.id, {
      title: 'Original title',
      content: 'Original content',
    });
    const updateInput = {
      ...extractionInput(project.id),
      bubble_id: original.id,
      expected_updated_at: original.updated_at,
    };

    const updated = service.updateFromDiscussionExtraction(updateInput);

    expect(updated.status).toBe('updated');

    if (updated.status !== 'updated') {
      throw new Error('Expected the extraction update to succeed.');
    }

    expect(updated.bubble).toEqual({
      ...original,
      title: 'Extracted decision',
      summary: 'A reusable decision from the discussion.',
      content: 'Choose the reversible launch path while demand is uncertain.',
      updated_at: '2026-07-29T09:00:00.001Z',
      source_kind: 'discussion',
      source_discussion_id: 'discussion-1',
      source_discussion_title: 'Launch tradeoffs',
      source_discussion_deleted_at: null,
      source_message_ids: ['message-1', 'message-2'],
      source_context_item_ids: ['context-1'],
    });
    expect(service.updateFromDiscussionExtraction(updateInput)).toEqual({
      status: 'replayed',
      bubble: updated.bubble,
    });

    const laterManualEdit = service.update(project.id, original.id, {
      title: 'Later manual edit',
    });
    expect(
      service.updateFromDiscussionExtraction({
        ...updateInput,
        extraction_id: 'extraction-2',
        expected_updated_at: updated.bubble.updated_at,
      }),
    ).toEqual({
      status: 'target_changed',
      bubble: laterManualEdit,
    });
  });

  it('rejects invalid extraction provenance before persistence', () => {
    const project = createProject();

    expect(() =>
      service.createFromDiscussionExtraction(
        extractionInput(project.id, {
          source_message_ids: ['message-1', 'message-1'],
          source_context_item_ids: [],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createFromDiscussionExtraction(
        extractionInput(project.id, {
          source_message_ids: [],
          source_context_item_ids: [],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(service.list(project.id)).toEqual([]);
  });

  it.each([
    [{ title: ' ', content: 'Valid' }, 'title', 'Title is required.'],
    [{ title: 'Valid', content: ' ' }, 'content', 'Content is required.'],
    [
      { title: 'Valid', content: 'Valid', summary: 42 },
      'summary',
      'Summary must be text.',
    ],
  ])('rejects invalid create input', (input, field, message) => {
    const project = createProject();

    expect(() => service.create(project.id, input as never)).toThrow(
      BadRequestException,
    );

    try {
      service.create(project.id, input as never);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('updates bubble content fields and advances updated_at', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const original = service.create(project.id, {
      title: 'Original title',
      summary: 'Original summary',
      content: 'Original content',
    });

    const updated = service.update(project.id, original.id, {
      title: '  Revised title  ',
      summary: null,
    });

    expect(updated).toEqual({
      ...original,
      title: 'Revised title',
      summary: null,
      updated_at: '2026-07-21T09:00:00.001Z',
    });
    expect(updated.content).toBe(original.content);
  });

  it.each([
    [{}, 'content', 'At least one content field must be provided.'],
    [{ title: ' ' }, 'title', 'Title is required.'],
    [{ content: '' }, 'content', 'Content is required.'],
    [{ summary: 12 }, 'summary', 'Summary must be text.'],
  ])('rejects invalid content updates', (input, field, message) => {
    const project = createProject();
    const bubble = service.create(project.id, {
      title: 'Bubble',
      content: 'Content',
    });

    try {
      service.update(project.id, bubble.id, input as never);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('scopes list, read, edit, and delete to the project', () => {
    const owningProject = createProject('Owner');
    const otherProject = createProject('Other');
    const bubble = service.create(owningProject.id, {
      title: 'Private to owner',
      content: 'Project-scoped knowledge',
    });

    expect(service.list(otherProject.id)).toEqual([]);

    const crossProjectOperations = [
      () => service.get(otherProject.id, bubble.id),
      () =>
        service.update(otherProject.id, bubble.id, { title: 'Unauthorized' }),
      () => service.delete(otherProject.id, bubble.id),
    ];

    for (const operation of crossProjectOperations) {
      try {
        operation();
        throw new Error('Expected the cross-project operation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'BUBBLE_NOT_FOUND',
          message: `Bubble "${bubble.id}" was not found in project "${otherProject.id}".`,
        });
      }
    }

    expect(service.get(owningProject.id, bubble.id)).toEqual(bubble);
  });

  it('returns stable errors for missing projects and bubble identifiers', () => {
    const project = createProject();

    expect(() => service.list('missing-project')).toThrow(NotFoundException);

    for (const operation of [
      () => service.get(project.id, 'missing-bubble'),
      () => service.update(project.id, 'missing-bubble', { title: 'New' }),
      () => service.delete(project.id, 'missing-bubble'),
    ]) {
      try {
        operation();
        throw new Error('Expected the missing bubble operation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'BUBBLE_NOT_FOUND',
          message: `Bubble "missing-bubble" was not found in project "${project.id}".`,
        });
      }
    }
  });

  it('deletes a bubble without changing other bubbles', () => {
    const project = createProject();
    const deleted = service.create(project.id, {
      title: 'Delete me',
      content: 'Temporary',
    });
    const retained = service.create(project.id, {
      title: 'Keep me',
      content: 'Durable',
    });

    service.delete(project.id, deleted.id);

    expect(service.list(project.id)).toEqual([retained]);
    expect(() => service.get(project.id, deleted.id)).toThrow(
      NotFoundException,
    );
  });

  it('persists bubbles when the repository is reopened', () => {
    const project = createProject();
    const created = service.create(project.id, {
      title: 'Persistent bubble',
      content: 'Survives a process restart.',
    });

    databaseProvider.onModuleDestroy();
    openRepositories();

    expect(service.get(project.id, created.id)).toEqual(created);
  });

  it('persists edited bubble content when the repository is reopened', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const created = service.create(project.id, {
      title: 'Original title',
      summary: 'Original summary',
      content: 'Original content',
    });
    jest.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    const updated = service.update(project.id, created.id, {
      title: 'Persisted title',
      summary: null,
      content: 'Persisted current knowledge.',
    });

    databaseProvider.onModuleDestroy();
    openRepositories();

    expect(service.get(project.id, created.id)).toEqual(updated);
    expect(updated.updated_at).toBe('2026-07-21T10:00:00.000Z');
  });
});
