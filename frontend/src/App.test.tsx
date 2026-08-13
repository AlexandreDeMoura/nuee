import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AnalyticsClient } from './analytics';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function projectFixture(id: string, title: string) {
  return {
    id,
    title,
    description: `Description for ${title}.`,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    canvas_viewport_x: 0,
    canvas_viewport_y: 0,
    canvas_zoom: 1,
  };
}

/** Stubs the transport so the real API client and its 204 handling are exercised. */
function stubFetch(projects: ReturnType<typeof projectFixture>[]) {
  const deleted: string[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (init?.method === 'DELETE') {
      deleted.push(url);
      return new Response(null, { status: 204 });
    }

    return new Response(
      JSON.stringify(projects.filter(({ id }) => !deleted.includes(id))),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  vi.stubGlobal('fetch', fetchStub);

  return { deleted };
}

describe('Project list deletion', () => {
  it('removes the deleted card, announces it, and keeps focus in the page', async () => {
    const { deleted } = stubFetch([
      projectFixture('project-one', 'Launch plan'),
      projectFixture('project-two', 'Hiring plan'),
    ]);
    const track = vi.fn();
    const analyticsClient: AnalyticsClient = { track };

    render(<App analyticsClient={analyticsClient} />);

    expect(await screen.findByText('Launch plan')).not.toBeNull();
    expect(screen.getByText('Hiring plan')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Hiring plan' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete “Hiring plan”?');

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(screen.queryByText('Hiring plan')).toBeNull());
    expect(deleted).toEqual([
      'http://localhost:3000/projects/project-two',
    ]);

    // The surviving project stays, and the count badge follows the list.
    expect(screen.getByText('Launch plan')).not.toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Hiring plan was deleted.',
    );
    expect(track).toHaveBeenCalledWith('project_deleted', {
      project_id: 'project-two',
    });

    // Focus would otherwise fall to the body: the dialog restores it to a
    // delete button that no longer exists.
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Your projects' }),
    );
  });

  it('shows the empty state once the last project is deleted', async () => {
    stubFetch([projectFixture('project-one', 'Launch plan')]);

    render(<App />);

    expect(await screen.findByText('Launch plan')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete project' }));

    expect(
      await screen.findByRole('heading', { name: 'Create your first project' }),
    ).not.toBeNull();
  });

  it('leaves the list untouched when the deletion fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return new Response(JSON.stringify({ code: 'PROJECT_NOT_FOUND' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify([projectFixture('project-one', 'Launch plan')]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    render(<App />);

    expect(await screen.findByText('Launch plan')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete project' }));

    expect(
      await screen.findByText('Couldn’t delete the project. Try again.'),
    ).not.toBeNull();
    expect(screen.getByText('Launch plan')).not.toBeNull();
  });
});
