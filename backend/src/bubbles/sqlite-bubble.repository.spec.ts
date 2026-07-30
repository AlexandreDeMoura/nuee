import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { BubbleProvenanceIntegrityError } from './bubble.types';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('SqliteBubbleRepository provenance integrity', () => {
  let temporaryDirectory: string;
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteBubbleRepository;
  let service: BubblesService;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubble-provenance-'));
    databaseProvider = new DatabaseProvider({
      databasePath: join(temporaryDirectory, 'bubbles.sqlite'),
    });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteBubbleRepository(databaseProvider);
    service = new BubblesService(projects, repository);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function createManualBubble() {
    const project = projects.create({
      title: 'Integrity project',
      description: 'Repository integrity checks.',
    });
    const bubble = service.create(project.id, {
      title: 'Stored bubble',
      content: 'Stored content',
    });

    databaseProvider.connection.exec(`
      DROP TRIGGER bubbles_provenance_update_guard;
      PRAGMA ignore_check_constraints = ON;
    `);

    return { project, bubble };
  }

  it('turns corrupt provenance JSON into a controlled repository failure', () => {
    const { project, bubble } = createManualBubble();
    databaseProvider.connection
      .prepare(
        `
          UPDATE bubbles
          SET source_context_item_ids = ?
          WHERE id = ?
        `,
      )
      .run('{not-json}', bubble.id);

    expect(() => repository.findByProjectAndId(project.id, bubble.id)).toThrow(
      BubbleProvenanceIntegrityError,
    );
  });

  it('rejects persisted provenance that is structurally inconsistent', () => {
    const { project, bubble } = createManualBubble();
    databaseProvider.connection
      .prepare(
        `
          UPDATE bubbles
          SET source_message_ids = ?
          WHERE id = ?
        `,
      )
      .run('["message-1","message-1"]', bubble.id);

    expect(() => repository.findByProjectAndId(project.id, bubble.id)).toThrow(
      BubbleProvenanceIntegrityError,
    );
  });

  it('marks only matching current discussion provenance as unavailable', () => {
    const project = projects.create({
      title: 'Provenance owner',
      description: 'Retain provenance after discussion deletion.',
    });
    const otherProject = projects.create({
      title: 'Other provenance owner',
      description: 'Keep project-scoped provenance isolated.',
    });
    const matchingResult = service.createFromDiscussionExtraction({
      project_id: project.id,
      extraction_id: 'extraction-matching',
      source_discussion_id: 'discussion-source',
      source_discussion_title: 'Frozen source title',
      source_message_ids: ['message-a'],
      source_context_item_ids: ['context-a'],
      title: 'Matching extraction',
      summary: 'Matching summary.',
      content: 'Matching extracted knowledge.',
      position_x: 120,
      position_y: -80,
    });
    const otherSourceResult = service.createFromDiscussionExtraction({
      project_id: project.id,
      extraction_id: 'extraction-other-source',
      source_discussion_id: 'discussion-other',
      source_discussion_title: 'Other frozen source',
      source_message_ids: ['message-b'],
      source_context_item_ids: [],
      title: 'Other extraction',
      summary: null,
      content: 'Knowledge from another discussion.',
      position_x: 420,
      position_y: -80,
    });
    const otherProjectResult = service.createFromDiscussionExtraction({
      project_id: otherProject.id,
      extraction_id: 'extraction-other-project',
      source_discussion_id: 'discussion-source',
      source_discussion_title: 'Same id in another project',
      source_message_ids: ['message-c'],
      source_context_item_ids: [],
      title: 'Other project extraction',
      summary: null,
      content: 'Knowledge belonging to another project.',
      position_x: 0,
      position_y: 0,
    });
    const manualBubble = service.create(project.id, {
      title: 'Manual bubble',
      content: 'Manual knowledge remains manual.',
    });

    if (
      matchingResult.status !== 'created' ||
      otherSourceResult.status !== 'created' ||
      otherProjectResult.status !== 'created'
    ) {
      throw new Error('Expected extraction bubbles to persist.');
    }

    const deletedAt = '2026-07-30T14:00:00.000Z';

    expect(
      repository.markSourceDiscussionDeleted(
        project.id,
        'discussion-source',
        deletedAt,
      ),
    ).toBe(1);
    expect(
      repository.findByProjectAndId(project.id, matchingResult.bubble.id),
    ).toEqual({
      ...matchingResult.bubble,
      source_discussion_deleted_at: deletedAt,
    });
    expect(
      repository.findByProjectAndId(project.id, otherSourceResult.bubble.id),
    ).toEqual(otherSourceResult.bubble);
    expect(
      repository.findByProjectAndId(
        otherProject.id,
        otherProjectResult.bubble.id,
      ),
    ).toEqual(otherProjectResult.bubble);
    expect(repository.findByProjectAndId(project.id, manualBubble.id)).toEqual(
      manualBubble,
    );
    expect(
      repository.markSourceDiscussionDeleted(
        project.id,
        'discussion-source',
        deletedAt,
      ),
    ).toBe(0);
  });
});
