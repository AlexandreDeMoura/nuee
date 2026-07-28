import { describe, expect, it } from 'vitest';
import type { DiscussionSummary } from '../src/api';
import { normalizeDiscussionList } from '../src/discussions';

const projectId = 'project-1';

function summary(
  id: string,
  lastActivityAt: string,
  overrides: Partial<DiscussionSummary> = {},
): DiscussionSummary {
  return {
    id,
    project_id: projectId,
    title: `Discussion ${id}`,
    created_at: '2026-07-28T08:00:00.000Z',
    updated_at: lastActivityAt,
    last_activity_at: lastActivityAt,
    is_active: false,
    ...overrides,
  };
}

describe('discussion list model', () => {
  it('orders by qualifying activity and derives exactly one Active discussion', () => {
    const discussions = normalizeDiscussionList(
      [
        summary('older', '2026-07-28T09:00:00.000Z', { is_active: true }),
        summary('latest', '2026-07-28T11:00:00.000Z'),
        summary('middle', '2026-07-28T10:00:00.000Z', {
          is_active: true,
        }),
      ],
      projectId,
    );

    expect(
      discussions.map(({ id, is_active }) => ({ id, is_active })),
    ).toEqual([
      { id: 'latest', is_active: true },
      { id: 'middle', is_active: false },
      { id: 'older', is_active: false },
    ]);
  });

  it('uses creation time and id as deterministic activity tie-breakers', () => {
    const activity = '2026-07-28T11:00:00.000Z';
    const discussions = normalizeDiscussionList(
      [
        summary('alpha', activity, {
          created_at: '2026-07-28T08:00:00.000Z',
        }),
        summary('beta', activity, {
          created_at: '2026-07-28T09:00:00.000Z',
        }),
        summary('gamma', activity, {
          created_at: '2026-07-28T09:00:00.000Z',
        }),
      ],
      projectId,
    );

    expect(discussions.map(({ id }) => id)).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
  });

  it('rejects duplicate, malformed, and cross-project records', () => {
    expect(() =>
      normalizeDiscussionList(
        [
          summary('duplicate', '2026-07-28T09:00:00.000Z'),
          summary('duplicate', '2026-07-28T10:00:00.000Z'),
        ],
        projectId,
      ),
    ).toThrow('invalid data');

    expect(() =>
      normalizeDiscussionList(
        [
          summary('cross-project', '2026-07-28T09:00:00.000Z', {
            project_id: 'project-2',
          }),
        ],
        projectId,
      ),
    ).toThrow('invalid data');

    expect(() =>
      normalizeDiscussionList(
        [
          summary('bad-date', 'not-a-date'),
        ],
        projectId,
      ),
    ).toThrow('invalid data');
  });
});
