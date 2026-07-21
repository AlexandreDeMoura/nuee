import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from '../src/App';
import type { Project } from '../src/api';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('project creation journey', () => {
  it('creates an empty project, reopens it, and reloads its edited description', async () => {
    let persistedProject: Project | null = null;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? input : input.url,
        );
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.pathname === '/projects') {
          return jsonResponse(persistedProject ? [persistedProject] : []);
        }

        if (method === 'POST' && url.pathname === '/projects') {
          const body = JSON.parse(String(init?.body)) as {
            title: string;
            description: string;
          };
          persistedProject = {
            id: 'project-journey',
            title: body.title,
            description: body.description,
            created_at: '2026-07-21T08:00:00.000Z',
            updated_at: '2026-07-21T08:00:00.000Z',
            canvas_viewport_x: 0,
            canvas_viewport_y: 0,
            canvas_zoom: 1,
          };

          return jsonResponse(persistedProject);
        }

        if (method === 'GET' && url.pathname === '/projects/project-journey') {
          return jsonResponse(persistedProject);
        }

        if (
          method === 'PATCH' &&
          url.pathname === '/projects/project-journey/description' &&
          persistedProject
        ) {
          const body = JSON.parse(String(init?.body)) as { description: string };
          persistedProject = {
            ...persistedProject,
            description: body.description,
            updated_at: '2026-07-21T08:05:00.000Z',
          };

          return jsonResponse(persistedProject);
        }

        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const firstSession = render(<App />);

    expect(await screen.findByText('Create your first project')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'New project',
      }),
    );

    const titleInput = screen.getByLabelText(/^Title/);
    const descriptionInput = screen.getByLabelText(/^Short description/);
    const createButton = screen.getByRole('button', {
      name: 'Create project',
    }) as HTMLButtonElement;

    fireEvent.change(titleInput, { target: { value: '   ' } });
    fireEvent.blur(titleInput);
    fireEvent.change(descriptionInput, { target: { value: '   ' } });
    fireEvent.blur(descriptionInput);

    expect(createButton.disabled).toBe(true);
    expect(screen.getByText('A title is required.')).toBeTruthy();
    expect(screen.getByText('A short description is required.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(titleInput, { target: { value: '  Launch plan  ' } });
    fireEvent.change(descriptionInput, {
      target: { value: '  Explore the launch constraints.  ' },
    });
    fireEvent.click(createButton);

    expect(
      await screen.findByText("Nothing here yet — that's on purpose."),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/projects/project-journey');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Launch plan');
    expect(persistedProject).toMatchObject({
      title: 'Launch plan',
      description: 'Explore the launch constraints.',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
    expect(document.querySelectorAll('[data-bubble-id]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Start a discussion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a bubble' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a document' })).toBeTruthy();

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    expect(projectTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    expect(screen.getByText('No discussions yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText('No documents yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    expect(screen.getByText('Nothing selected')).toBeTruthy();
    expect(window.location.pathname).toBe('/projects/project-journey');

    fireEvent.click(screen.getByRole('link', { name: 'Projects' }));
    const projectLink = await screen.findByRole('link', { name: /Launch plan/ });
    expect(projectLink.textContent).toContain('Explore the launch constraints.');
    fireEvent.click(projectLink);

    expect(
      await screen.findByText("Nothing here yet — that's on purpose."),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/projects/project-journey');
    expect(
      screen.getByRole('tab', { name: 'Project' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();

    const editor = screen.getByLabelText('Project description') as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: 'Persisted across later sessions.' },
    });

    expect(editor.value).toBe('Persisted across later sessions.');
    await waitFor(
      () =>
        expect(persistedProject?.description).toBe(
          'Persisted across later sessions.',
        ),
      { timeout: 1500 },
    );
    expect(screen.getByText('All changes saved.')).toBeTruthy();
    expect(persistedProject).toMatchObject({
      id: 'project-journey',
      title: 'Launch plan',
      description: 'Persisted across later sessions.',
      created_at: '2026-07-21T08:00:00.000Z',
      updated_at: '2026-07-21T08:05:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });

    firstSession.unmount();
    render(<App />);

    const reloadedEditor = await screen.findByLabelText('Project description');
    expect((reloadedEditor as HTMLTextAreaElement).value).toBe(
      'Persisted across later sessions.',
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Launch plan');
    expect(window.location.pathname).toBe('/projects/project-journey');
    expect(screen.queryByText('No discussions yet')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
