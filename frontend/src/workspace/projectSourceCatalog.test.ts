import { describe, expect, it } from 'vitest';
import type { Bubble } from '../api';
import { filterDiscussionSourceCatalog } from '../discussions/discussionSourceCatalog';
import { documentSummaryFixture } from '../documents/documentTestFixtures';
import { createProjectSourceCatalog } from './projectSourceCatalog';

function bubbleFixture(
  overrides: Partial<Bubble> & Pick<Bubble, 'id' | 'project_id'>,
): Bubble {
  return {
    content: 'Fallback bubble content.',
    created_at: '2026-08-01T10:00:00.000Z',
    territory_id: 'territory-one',
    source_context_item_ids: [],
    source_discussion_deleted_at: null,
    source_discussion_id: null,
    source_discussion_title: null,
    source_kind: 'manual',
    source_message_ids: [],
    summary: null,
    title: 'Project finding',
    updated_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('createProjectSourceCatalog', () => {
  it('maps project bubbles and document readiness without exposing other projects', () => {
    const catalog = createProjectSourceCatalog({
      bubbles: [
        bubbleFixture({
          id: 'bubble-ranking',
          project_id: 'project-current',
          summary: 'Ranking favours recent account activity.',
          title: 'Recommendation ranking rewrite',
        }),
        bubbleFixture({
          id: 'bubble-foreign',
          project_id: 'project-other',
        }),
      ],
      documents: [
        documentSummaryFixture({
          id: 'document-ready',
          processing_status: 'ready',
          project_id: 'project-current',
          size_bytes: 2_048,
          title: 'Recurring-revenue review',
        }),
        documentSummaryFixture({
          id: 'document-processing',
          processing_status: 'processing',
          project_id: 'project-current',
          title: 'Interview transcript',
        }),
        documentSummaryFixture({
          id: 'document-failed',
          processing_status: 'failed',
          project_id: 'project-current',
          title: 'Unreadable report',
        }),
        documentSummaryFixture({
          id: 'document-foreign',
          project_id: 'project-other',
        }),
      ],
      projectId: 'project-current',
    });

    expect(catalog).toEqual({
      projectId: 'project-current',
      sources: [
        {
          id: 'bubble-ranking',
          kind: 'bubble',
          secondaryLine: 'Ranking favours recent account activity.',
          title: 'Recommendation ranking rewrite',
        },
        {
          id: 'document-ready',
          kind: 'document',
          readiness: { status: 'ready' },
          secondaryLine: 'Whole document · 2 KiB',
          title: 'Recurring-revenue review',
        },
        {
          id: 'document-processing',
          kind: 'document',
          readiness: { reason: 'processing', status: 'not_ready' },
          secondaryLine: 'Whole document · 128 bytes',
          title: 'Interview transcript',
        },
        {
          id: 'document-failed',
          kind: 'document',
          readiness: { reason: 'failed', status: 'not_ready' },
          secondaryLine: 'Whole document · 128 bytes',
          title: 'Unreadable report',
        },
      ],
    });
  });

  it('represents an empty project and filters titles and secondary lines', () => {
    const emptyCatalog = createProjectSourceCatalog({
      bubbles: [],
      documents: [],
      projectId: 'project-empty',
    });
    const catalog = createProjectSourceCatalog({
      bubbles: [
        bubbleFixture({
          id: 'bubble-one',
          project_id: 'project-current',
          summary: 'Accounts improve after a teammate invitation.',
          title: 'Onboarding finding',
        }),
      ],
      documents: [
        documentSummaryFixture({
          id: 'document-one',
          project_id: 'project-current',
          title: 'Revenue Review',
        }),
      ],
      projectId: 'project-current',
    });

    expect(emptyCatalog.sources).toEqual([]);
    expect(filterDiscussionSourceCatalog(catalog, 'revenue')).toEqual([
      catalog.sources[1],
    ]);
    expect(filterDiscussionSourceCatalog(catalog, 'TEAMMATE')).toEqual([
      catalog.sources[0],
    ]);
    expect(filterDiscussionSourceCatalog(catalog, '   ')).toBe(
      catalog.sources,
    );
    expect(filterDiscussionSourceCatalog(catalog, 'missing')).toEqual([]);
  });
});
