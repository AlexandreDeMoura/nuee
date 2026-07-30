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
  let repository: SqliteBubbleRepository;
  let service: BubblesService;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubble-provenance-'));
    databaseProvider = new DatabaseProvider({
      databasePath: join(temporaryDirectory, 'bubbles.sqlite'),
    });
    const projects = new ProjectsService(
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
    const project = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    ).create({
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
});
