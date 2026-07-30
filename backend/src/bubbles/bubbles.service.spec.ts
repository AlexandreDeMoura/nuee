import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import type { CreateBubbleFromDiscussionExtractionInput } from './bubble.types';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblesService', () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let databaseProvider: DatabaseProvider;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let service: BubblesService;

  function openRepositories(): void {
    databaseProvider = new DatabaseProvider({ databasePath });
    projectRepository = new SqliteProjectRepository(databaseProvider);
    bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    projects = new ProjectsService(projectRepository);
    service = new BubblesService(projects, bubbleRepository);
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
      position_x: 272,
      position_y: -178,
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
      title: 'Decision criteria',
      summary: null,
      content: 'Prefer reversible choices.',
      position_x: 0,
      position_y: 0,
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

  it('accepts an optional summary and initial finite position', () => {
    const project = createProject();

    const bubble = service.create(project.id, {
      title: 'Placed bubble',
      summary: '  A concise summary.  ',
      content: 'Full content',
      position_x: -125.5,
      position_y: 240,
    });

    expect(bubble).toMatchObject({
      summary: 'A concise summary.',
      position_x: -125.5,
      position_y: 240,
    });
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
        title: 'Extracted decision',
        summary: 'A reusable decision from the discussion.',
        content: 'Choose the reversible launch path while demand is uncertain.',
        position_x: 272,
        position_y: -178,
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
      position_x: 42,
      position_y: -24,
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
    expect(laterManualEdit.position_x).toBe(original.position_x);
    expect(laterManualEdit.position_y).toBe(original.position_y);
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
    [
      { title: 'Valid', content: 'Valid', position_x: Number.NaN },
      'position_x',
      'Horizontal position must be a finite number.',
    ],
    [
      {
        title: 'Valid',
        content: 'Valid',
        position_y: Number.POSITIVE_INFINITY,
      },
      'position_y',
      'Vertical position must be a finite number.',
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
      position_x: 12,
      position_y: 24,
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
    expect(updated.position_x).toBe(original.position_x);
    expect(updated.position_y).toBe(original.position_y);
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

  it('repositions without changing content updated_at or another bubble', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const movedBubble = service.create(project.id, {
      title: 'Moved',
      content: 'Moved content',
    });
    const untouchedBubble = service.create(project.id, {
      title: 'Untouched',
      content: 'Untouched content',
      position_x: 50,
      position_y: 75,
    });
    jest.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));

    const repositioned = service.reposition(project.id, movedBubble.id, {
      position_x: -80.25,
      position_y: 320.5,
    });

    expect(repositioned).toEqual({
      ...movedBubble,
      position_x: -80.25,
      position_y: 320.5,
    });
    expect(repositioned.updated_at).toBe(movedBubble.updated_at);
    expect(service.get(project.id, untouchedBubble.id)).toEqual(
      untouchedBubble,
    );
  });

  it('repositions a project batch atomically without changing bubble content metadata', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const first = service.create(project.id, {
      title: 'First',
      summary: 'First summary',
      content: 'First content',
      position_x: 10,
      position_y: 20,
    });
    const second = service.create(project.id, {
      title: 'Second',
      content: 'Second content',
      position_x: 400,
      position_y: 500,
    });

    const repositioned = service.repositionMany(project.id, {
      positions: [
        { bubble_id: second.id, position_x: 282, position_y: 20 },
        { bubble_id: first.id, position_x: 10, position_y: 198 },
      ],
    });

    expect(repositioned).toEqual([
      { ...second, position_x: 282, position_y: 20 },
      { ...first, position_x: 10, position_y: 198 },
    ]);
    expect(repositioned[0]).toMatchObject({
      title: second.title,
      summary: second.summary,
      content: second.content,
      source_kind: second.source_kind,
      updated_at: second.updated_at,
    });
    expect(repositioned[1]).toMatchObject({
      title: first.title,
      summary: first.summary,
      content: first.content,
      source_kind: first.source_kind,
      updated_at: first.updated_at,
    });
  });

  it('rejects an invalid or cross-project position batch before changing any bubble', () => {
    const project = createProject('Owner');
    const otherProject = createProject('Other');
    const first = service.create(project.id, {
      title: 'First',
      content: 'First content',
      position_x: 10,
      position_y: 20,
    });
    const other = service.create(otherProject.id, {
      title: 'Other project',
      content: 'Other content',
      position_x: 30,
      position_y: 40,
    });

    expect(() =>
      service.repositionMany(project.id, {
        positions: [
          { bubble_id: first.id, position_x: 100, position_y: 200 },
          { bubble_id: other.id, position_x: 300, position_y: 400 },
        ],
      }),
    ).toThrow(NotFoundException);
    expect(service.get(project.id, first.id)).toEqual(first);
    expect(service.get(otherProject.id, other.id)).toEqual(other);

    expect(() =>
      service.repositionMany(project.id, {
        positions: [
          { bubble_id: first.id, position_x: 1, position_y: 2 },
          { bubble_id: first.id, position_x: 3, position_y: 4 },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(service.get(project.id, first.id)).toEqual(first);
  });

  it.each([
    [
      { position_x: '0', position_y: 1 },
      'position_x',
      'Horizontal position must be a finite number.',
    ],
    [
      { position_x: 0, position_y: undefined },
      'position_y',
      'Vertical position must be a finite number.',
    ],
  ])('rejects invalid reposition input', (input, field, message) => {
    const project = createProject();
    const bubble = service.create(project.id, {
      title: 'Bubble',
      content: 'Content',
    });

    try {
      service.reposition(project.id, bubble.id, input as never);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('scopes list, read, edit, reposition, and delete to the project', () => {
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
      () =>
        service.reposition(otherProject.id, bubble.id, {
          position_x: 1,
          position_y: 2,
        }),
      () =>
        service.repositionMany(otherProject.id, {
          positions: [{ bubble_id: bubble.id, position_x: 1, position_y: 2 }],
        }),
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
      () =>
        service.reposition(project.id, 'missing-bubble', {
          position_x: 1,
          position_y: 2,
        }),
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
      position_x: 10,
      position_y: -20,
    });
    const repositioned = service.reposition(project.id, created.id, {
      position_x: -144.5,
      position_y: 280,
    });

    databaseProvider.onModuleDestroy();
    openRepositories();

    expect(service.get(project.id, created.id)).toEqual(repositioned);
    expect(repositioned.updated_at).toBe(created.updated_at);
  });

  it('persists edited bubble content when the repository is reopened', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const created = service.create(project.id, {
      title: 'Original title',
      summary: 'Original summary',
      content: 'Original content',
      position_x: 10,
      position_y: -20,
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
    expect(updated.position_x).toBe(created.position_x);
    expect(updated.position_y).toBe(created.position_y);
  });
});
