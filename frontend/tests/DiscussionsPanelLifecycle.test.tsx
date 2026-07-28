import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  DiscussionDetails,
  DiscussionSummary,
  Project,
} from '../src/api';
import { ProjectWorkspace } from '../src/workspace/ProjectWorkspace';

const project: Project = {
  id: 'project-discussions',
  title: 'Launch plan',
  description: 'Explore the launch constraints.',
  created_at: '2026-07-28T08:00:00.000Z',
  updated_at: '2026-07-28T08:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

function summary(
  id: string,
  title: string,
  lastActivityAt: string,
  isActive: boolean,
): DiscussionSummary {
  return {
    id,
    project_id: project.id,
    title,
    created_at: '2026-07-28T08:00:00.000Z',
    updated_at: lastActivityAt,
    last_activity_at: lastActivityAt,
    is_active: isActive,
  };
}

function details(
  discussion: DiscussionSummary,
  overrides: Partial<DiscussionDetails> = {},
): DiscussionDetails {
  return {
    id: discussion.id,
    project_id: discussion.project_id,
    title: discussion.title,
    frozen_context: {
      project_description: { content: project.description },
    },
    created_at: discussion.created_at,
    updated_at: discussion.updated_at,
    last_activity_at: discussion.last_activity_at,
    messages: [
      {
        id: `user-${discussion.id}`,
        discussion_id: discussion.id,
        role: 'user',
        content: `Question for ${discussion.title}`,
        created_at: '2026-07-28T08:00:00.000Z',
        status: 'completed',
        request_id: `request-${discussion.id}`,
      },
      {
        id: `assistant-${discussion.id}`,
        discussion_id: discussion.id,
        role: 'assistant',
        content: `Answer for ${discussion.title}`,
        created_at: '2026-07-28T08:00:01.000Z',
        status: 'completed',
        request_id: null,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('discussions panel lifecycle', () => {
  it('loads project records, normalizes ordering and Active, and records only explicit opens', async () => {
    const older = summary(
      'discussion-older',
      'Earlier launch risks',
      '2026-07-28T09:00:00.000Z',
      true,
    );
    const latest = summary(
      'discussion-latest',
      'Current launch plan',
      '2026-07-28T10:00:00.000Z',
      false,
    );
    const openedOlder = details(older, {
      updated_at: '2026-07-28T11:00:00.000Z',
      last_activity_at: '2026-07-28T11:00:00.000Z',
    });
    const list = vi.fn(async () => [older, latest]);
    const recordOpen = vi.fn(async () => openedOlder);
    const get = vi.fn(async () => openedOlder);

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ get }}
        discussionPanelRequests={{ list, recordOpen }}
        project={project}
        requestBubbles={async () => []}
        requestBubbleLinks={async () => []}
      />,
    );

    expect(recordOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));

    const discussionList = await screen.findByRole('list', {
      name: 'Project discussions',
    });
    const rows = within(discussionList).getAllByRole('button');

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Current launch plan'),
      expect.stringContaining('Earlier launch risks'),
    ]);
    expect(within(rows[0]).getByText('ACTIVE')).toBeTruthy();
    expect(within(rows[1]).queryByText('ACTIVE')).toBeNull();
    expect(screen.getAllByText('ACTIVE')).toHaveLength(1);
    expect(list).toHaveBeenCalledWith(project.id, expect.any(AbortSignal));
    expect(recordOpen).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open discussion: Earlier launch risks',
      }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Earlier launch risks' }),
    ).toBeTruthy();
    expect(recordOpen).toHaveBeenCalledTimes(1);
    expect(recordOpen).toHaveBeenCalledWith(
      project.id,
      older.id,
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByText('Answer for Earlier launch risks'),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );

    expect(recordOpen).toHaveBeenCalledTimes(1);
    const reorderedList = screen.getByRole('list', {
      name: 'Project discussions',
    });
    const reorderedRows = within(reorderedList).getAllByRole('button');
    expect(reorderedRows[0].textContent).toContain('Earlier launch risks');
    expect(within(reorderedRows[0]).getByText('ACTIVE')).toBeTruthy();

    fireEvent.click(reorderedRows[0]);
    await screen.findByRole('dialog', { name: 'Earlier launch risks' });
    expect(recordOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps list loading failures visible and retryable', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('Discussion service unavailable.'))
      .mockResolvedValueOnce([]);

    render(
      <ProjectWorkspace
        discussionPanelRequests={{ list }}
        project={project}
        requestBubbles={async () => []}
        requestBubbleLinks={async () => []}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));

    expect(await screen.findByText('Couldn’t load discussions')).toBeTruthy();
    expect(screen.getByText('Discussion service unavailable.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No discussions yet')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('adds a newly persisted discussion to the panel as Active without creating an empty row', async () => {
    const createdSummary = summary(
      'discussion-created',
      'New discussion',
      '2026-07-28T12:00:00.000Z',
      true,
    );
    const created = details(createdSummary);
    const create = vi.fn(async () => created);
    const get = vi.fn(async () => created);
    const list = vi.fn(async () => [createdSummary]);

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create, get }}
        discussionPanelRequests={{ list }}
        project={project}
        requestBubbles={async () => []}
        requestBubbleLinks={async () => []}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a discussion' }),
    );

    expect(screen.queryByText('New discussion', { selector: 'li *' })).toBeNull();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Discussion prompt' }),
      { target: { value: 'What blocks the launch?' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(await screen.findByText('Answer for New discussion')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));

    expect(
      await screen.findByRole('button', {
        name: 'Open discussion: New discussion',
      }),
    ).toBeTruthy();
    expect(screen.getAllByText('ACTIVE')).toHaveLength(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });
});
