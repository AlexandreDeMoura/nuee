import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from '../territories/sqlite-territory.repository';
import { TerritoriesService } from '../territories/territories.service';
import { DiscussionContextAssembler } from './discussion-context.assembler';
import {
  DiscussionContextSourceError,
  DocumentContextSourceReadResult,
  DocumentContextSourceReader,
} from './discussion-context.types';

class FakeDocumentContextSourceReader implements DocumentContextSourceReader {
  readonly results = new Map<string, DocumentContextSourceReadResult>();
  readonly reads: Array<{ projectId: string; documentId: string }> = [];

  readContextSource(
    projectId: string,
    documentId: string,
  ): DocumentContextSourceReadResult {
    this.reads.push({ projectId, documentId });

    return (
      this.results.get(documentId) ?? {
        status: 'unavailable',
        reason: 'missing',
      }
    );
  }
}

describe('DiscussionContextAssembler', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let bubbles: BubblesService;
  let documents: FakeDocumentContextSourceReader;
  let assembler: DiscussionContextAssembler;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-28T09:30:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    bubbles = new BubblesService(
      projects,
      new SqliteBubbleRepository(databaseProvider),
      new TerritoriesService(
        projects,
        new SqliteTerritoryRepository(databaseProvider),
      ),
      new DatabaseTransaction(databaseProvider),
    );
    documents = new FakeDocumentContextSourceReader();
    assembler = new DiscussionContextAssembler(projects, bubbles, documents);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createProject(title = 'Research') {
    return projects.create({
      title,
      description: `${title} description`,
    });
  }

  it('always creates a frozen project-description item', () => {
    const project = createProject();

    const context = assembler.assemble(project.id, {
      bubble_ids: [],
      document_ids: [],
    });

    expect(context).toEqual({
      version: 1,
      items: [
        {
          id: context.items[0].id,
          source_kind: 'project_description',
          source_id: project.id,
          source_title: 'Project description',
          frozen_content: project.description,
          created_at: '2026-07-28T09:30:00.000Z',
          display_order: 0,
        },
      ],
    });
    expect(context.items[0].id).not.toHaveLength(0);
  });

  it('deduplicates sources in first-confirmed order and freezes complete live content', () => {
    const project = createProject();
    const firstBubble = bubbles.create(project.id, {
      title: 'First bubble',
      summary: 'Display-only summary',
      content: 'Complete first synthesized content.',
    });
    const secondBubble = bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Complete second synthesized content.',
    });
    documents.results.set('document-1', {
      status: 'available',
      source: {
        id: 'document-1',
        project_id: project.id,
        title: 'First document',
        processing_status: 'ready',
        processed_text: 'Complete first processed document.',
      },
    });
    documents.results.set('document-2', {
      status: 'available',
      source: {
        id: 'document-2',
        project_id: project.id,
        title: 'Second document',
        processing_status: 'ready',
        processed_text: 'Complete second processed document.',
      },
    });

    const context = assembler.assemble(project.id, {
      bubble_ids: [secondBubble.id, firstBubble.id, secondBubble.id],
      document_ids: ['document-2', 'document-1', 'document-2'],
    });

    expect(
      context.items.map(
        ({
          source_kind,
          source_id,
          source_title,
          frozen_content,
          display_order,
        }) => ({
          source_kind,
          source_id,
          source_title,
          frozen_content,
          display_order,
        }),
      ),
    ).toEqual([
      {
        source_kind: 'project_description',
        source_id: project.id,
        source_title: 'Project description',
        frozen_content: project.description,
        display_order: 0,
      },
      {
        source_kind: 'bubble',
        source_id: secondBubble.id,
        source_title: 'Second bubble',
        frozen_content: 'Complete second synthesized content.',
        display_order: 1,
      },
      {
        source_kind: 'bubble',
        source_id: firstBubble.id,
        source_title: 'First bubble',
        frozen_content: 'Complete first synthesized content.',
        display_order: 2,
      },
      {
        source_kind: 'document',
        source_id: 'document-2',
        source_title: 'Second document',
        frozen_content: 'Complete second processed document.',
        display_order: 3,
      },
      {
        source_kind: 'document',
        source_id: 'document-1',
        source_title: 'First document',
        frozen_content: 'Complete first processed document.',
        display_order: 4,
      },
    ]);
    expect(new Set(context.items.map((item) => item.id)).size).toBe(5);
    expect(new Set(context.items.map((item) => item.created_at))).toEqual(
      new Set(['2026-07-28T09:30:00.000Z']),
    );
    expect(documents.reads).toEqual([
      { projectId: project.id, documentId: 'document-2' },
      { projectId: project.id, documentId: 'document-1' },
    ]);
  });

  it('reads latest source values at assembly and leaves the package frozen afterward', () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Initial bubble title',
      content: 'Initial bubble content',
    });
    projects.updateDescription(project.id, {
      description: 'Latest project description',
    });
    bubbles.update(project.id, bubble.id, {
      title: 'Latest bubble title',
      content: 'Latest bubble content',
    });
    documents.results.set('document-1', {
      status: 'available',
      source: {
        id: 'document-1',
        project_id: project.id,
        title: 'Latest document title',
        processing_status: 'ready',
        processed_text: 'Latest processed text',
      },
    });

    const context = assembler.assemble(project.id, {
      bubble_ids: [bubble.id],
      document_ids: ['document-1'],
    });

    projects.updateDescription(project.id, {
      description: 'Changed after assembly',
    });
    bubbles.update(project.id, bubble.id, {
      title: 'Changed after assembly',
      content: 'Changed after assembly',
    });
    documents.results.set('document-1', {
      status: 'available',
      source: {
        id: 'document-1',
        project_id: project.id,
        title: 'Changed after assembly',
        processing_status: 'ready',
        processed_text: 'Changed after assembly',
      },
    });

    expect(
      context.items.map((item) => ({
        title: item.source_title,
        content: item.frozen_content,
      })),
    ).toEqual([
      {
        title: 'Project description',
        content: 'Latest project description',
      },
      { title: 'Latest bubble title', content: 'Latest bubble content' },
      { title: 'Latest document title', content: 'Latest processed text' },
    ]);
  });

  it('returns structured errors for every unavailable selected source', () => {
    const project = createProject('Owner');
    const otherProject = createProject('Other');
    const crossProjectBubble = bubbles.create(otherProject.id, {
      title: 'Other bubble',
      content: 'Other project content',
    });
    documents.results.set('document-inaccessible', {
      status: 'unavailable',
      reason: 'inaccessible',
    });
    documents.results.set('document-cross-project', {
      status: 'available',
      source: {
        id: 'document-cross-project',
        project_id: otherProject.id,
        title: 'Other document',
        processing_status: 'ready',
        processed_text: 'Other project text',
      },
    });
    documents.results.set('document-pending', {
      status: 'available',
      source: {
        id: 'document-pending',
        project_id: project.id,
        title: 'Pending document',
        processing_status: 'processing',
        processed_text: null,
      },
    });
    documents.results.set('document-failed', {
      status: 'available',
      source: {
        id: 'document-failed',
        project_id: project.id,
        title: 'Failed document',
        processing_status: 'failed',
        processed_text: null,
      },
    });
    documents.results.set('document-empty', {
      status: 'available',
      source: {
        id: 'document-empty',
        project_id: project.id,
        title: 'Empty document',
        processing_status: 'ready',
        processed_text: ' ',
      },
    });

    expect.assertions(3);

    try {
      assembler.assemble(project.id, {
        bubble_ids: ['missing-bubble', crossProjectBubble.id],
        document_ids: [
          'missing-document',
          'document-inaccessible',
          'document-cross-project',
          'document-pending',
          'document-failed',
          'document-empty',
          'document-pending',
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DiscussionContextSourceError);
      expect((error as DiscussionContextSourceError).code).toBe(
        'DISCUSSION_CONTEXT_SOURCE_INVALID',
      );
      expect((error as DiscussionContextSourceError).issues).toEqual([
        {
          source_kind: 'bubble',
          source_id: 'missing-bubble',
          reason: 'missing',
        },
        {
          source_kind: 'bubble',
          source_id: crossProjectBubble.id,
          reason: 'cross_project',
        },
        {
          source_kind: 'document',
          source_id: 'missing-document',
          reason: 'missing',
        },
        {
          source_kind: 'document',
          source_id: 'document-inaccessible',
          reason: 'inaccessible',
        },
        {
          source_kind: 'document',
          source_id: 'document-cross-project',
          reason: 'cross_project',
        },
        {
          source_kind: 'document',
          source_id: 'document-pending',
          reason: 'processing',
        },
        {
          source_kind: 'document',
          source_id: 'document-failed',
          reason: 'failed',
        },
        {
          source_kind: 'document',
          source_id: 'document-empty',
          reason: 'failed',
        },
      ]);
    }
  });

  it('does not alter source timestamps, positions, or document metadata', () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Stable bubble',
      content: 'Stable content',
    });
    const originalProject = projects.get(project.id);
    const originalBubble = bubbles.get(project.id, bubble.id);
    const documentSource = {
      id: 'document-1',
      project_id: project.id,
      title: 'Stable document',
      processing_status: 'ready' as const,
      processed_text: 'Stable processed text',
    };
    documents.results.set('document-1', {
      status: 'available',
      source: documentSource,
    });

    assembler.assemble(project.id, {
      bubble_ids: [bubble.id],
      document_ids: ['document-1'],
    });

    expect(projects.get(project.id)).toEqual(originalProject);
    expect(bubbles.get(project.id, bubble.id)).toEqual(originalBubble);
    expect(documents.results.get('document-1')).toEqual({
      status: 'available',
      source: documentSource,
    });
  });
});
