import { describe, expect, it } from 'vitest';
import type { DiscussionDetails } from '../api';
import { getDiscussionContextFrozenAt } from './discussionContextModel';

const discussion: DiscussionDetails = {
  id: 'discussion-1',
  project_id: 'project-1',
  title: 'Frozen discussion',
  created_at: '2026-08-01T14:31:59.000Z',
  updated_at: '2026-08-01T14:32:00.000Z',
  last_activity_at: '2026-08-01T14:32:00.000Z',
  messages: [],
  frozen_context: {
    version: 1,
    items: [
      {
        id: 'context-project',
        source_id: 'project-1',
        source_kind: 'project_description',
        source_title: 'Project description',
        frozen_content: 'Persisted project context.',
        created_at: '2026-08-01T14:32:00.000Z',
        display_order: 0,
      },
    ],
  },
};

describe('getDiscussionContextFrozenAt', () => {
  it('uses the persisted frozen package timestamp', () => {
    expect(getDiscussionContextFrozenAt(discussion)).toBe(
      '2026-08-01T14:32:00.000Z',
    );
  });

  it('does not infer a frozen state for legacy context', () => {
    expect(
      getDiscussionContextFrozenAt({
        ...discussion,
        frozen_context: {},
      }),
    ).toBeNull();
  });
});
