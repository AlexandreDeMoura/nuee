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
  it('creates the project before handing optional uploads to its Documents panel', async () => {
    const createdProject: Project = {
      id: 'project-with-documents',
      title: 'Source review',
      description: 'Review the supplied source material.',
      created_at: '2026-07-31T08:00:00.000Z',
      updated_at: '2026-07-31T08:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    };
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL
            ? input
            : input.url,
        );
        const method = init?.method ?? 'GET';
        requestOrder.push(`${method} ${url.pathname}`);

        if (method === 'GET' && url.pathname === '/projects') {
          return jsonResponse([]);
        }
        if (method === 'GET' && url.pathname === '/document-upload-policy') {
          return jsonResponse({
            max_documents_per_project: 25,
            max_file_size_bytes: 10 * 1024 * 1024,
            max_files_per_request: 1,
            max_project_storage_bytes: 100 * 1024 * 1024,
            supported_formats: [
              {
                category: 'plain_text',
                extensions: ['.txt'],
                mime_types: ['text/plain'],
              },
            ],
          });
        }
        if (method === 'POST' && url.pathname === '/projects') {
          return jsonResponse(createdProject);
        }
        if (
          method === 'GET' &&
          url.pathname === '/projects/project-with-documents'
        ) {
          return jsonResponse(createdProject);
        }
        if (
          method === 'GET' &&
          (url.pathname === '/projects/project-with-documents/bubbles' ||
            url.pathname === '/projects/project-with-documents/bubble-links' ||
            url.pathname === '/projects/project-with-documents/documents')
        ) {
          return jsonResponse([]);
        }
        if (
          method === 'POST' &&
          url.pathname === '/projects/project-with-documents/documents'
        ) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ message: 'Upload unavailable.' }),
          };
        }

        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'New project' }),
    );
    const documentInput = await screen.findByLabelText(/^Documents/);
    const source = new File(['Source material'], 'source.txt', {
      type: 'text/plain',
    });
    fireEvent.change(documentInput, { target: { files: [source] } });
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Source review' },
    });
    fireEvent.change(screen.getByLabelText(/^Short description/), {
      target: { value: 'Review the supplied source material.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(window.location.pathname).toBe('/projects/project-with-documents'),
    );
    expect(
      screen.getByRole('tab', { name: 'Documents' }).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    expect(await screen.findByText('Upload unavailable.')).toBeTruthy();
    expect(screen.getByText('source.txt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Source review',
    );

    const createIndex = requestOrder.indexOf('POST /projects');
    const uploadIndex = requestOrder.indexOf(
      'POST /projects/project-with-documents/documents',
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(createIndex);
  });

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
          method === 'GET' &&
          url.pathname === '/projects/project-journey/bubbles'
        ) {
          return jsonResponse([]);
        }

        if (
          method === 'GET' &&
          url.pathname === '/projects/project-journey/discussions'
        ) {
          return jsonResponse([]);
        }

        if (method === 'GET' && url.pathname === '/document-upload-policy') {
          return jsonResponse({
            max_documents_per_project: 25,
            max_file_size_bytes: 10 * 1024 * 1024,
            max_files_per_request: 1,
            max_project_storage_bytes: 100 * 1024 * 1024,
            supported_formats: [
              {
                category: 'plain_text',
                extensions: ['.txt'],
                mime_types: ['text/plain'],
              },
            ],
          });
        }

        if (
          method === 'GET' &&
          url.pathname === '/projects/project-journey/documents'
        ) {
          return jsonResponse([]);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
    expect(await screen.findByText('No discussions yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('No documents yet')).toBeTruthy();
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
