import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PROJECT_DESCRIPTION_MAX_LENGTH } from '@nuee/shared-types';
import App from '../src/App';
import type { DocumentUploadPolicy, Project } from '../src/api';
import { CreateProjectDialog } from '../src/projects/CreateProjectDialog';

const project: Project = {
  id: 'project-123',
  title: 'Launch plan',
  description: 'Explore the launch constraints.',
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

const documentUploadPolicy: DocumentUploadPolicy = {
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
};

const requestDocumentPolicy = async () => documentUploadPolicy;

const validDescriptionInput = '  Explore the launch constraints.  ';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: '  Launch plan  ' },
  });
  fireEvent.change(screen.getByLabelText(/^Short description/), {
    target: { value: validDescriptionInput },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('CreateProjectDialog', () => {
  it('starts focused and becomes ready when both trimmed fields are valid', () => {
    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        requestCreate={vi.fn()}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    const title = screen.getByLabelText(/^Title/);
    const description = screen.getByLabelText(/^Short description/);
    const submit = screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement;

    expect(document.activeElement).toBe(title);
    expect(submit.disabled).toBe(true);
    expect(description.getAttribute('maxlength')).toBe(
      String(PROJECT_DESCRIPTION_MAX_LENGTH),
    );
    expect(screen.getByText(`0 / ${PROJECT_DESCRIPTION_MAX_LENGTH}`)).toBeTruthy();

    fillValidForm();

    expect(submit.disabled).toBe(false);
    expect(
      screen.getByText(
        `${validDescriptionInput.length} / ${PROJECT_DESCRIPTION_MAX_LENGTH}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('2 FIELDS · NO DOCUMENTS')).toBeTruthy();
  });

  it('shows no validation on open when StrictMode remounts the dialog', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    render(
      <StrictMode>
        <CreateProjectDialog
          onCancel={vi.fn()}
          onCreated={vi.fn()}
          requestCreate={vi.fn()}
          requestDocumentPolicy={requestDocumentPolicy}
        />
      </StrictMode>,
    );

    const title = screen.getByLabelText(/^Title/);

    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('aria-invalid')).toBe('false');
    expect(
      screen.getByText('A title is required.').className,
    ).toContain('invisible');
    expect(screen.getByText('INCOMPLETE').className).not.toContain('bg-[#f7ecec]');

    trigger.remove();
  });

  it('keeps whitespace-only fields invalid and exposes field-level errors after blur', () => {
    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        requestCreate={vi.fn()}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    const title = screen.getByLabelText(/^Title/);
    const description = screen.getByLabelText(/^Short description/);

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    fireEvent.change(description, { target: { value: '   ' } });
    fireEvent.blur(description);

    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(description.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('A title is required.')).toBeTruthy();
    expect(screen.getByText('A short description is required.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('blocks duplicate submission, editing, cancellation, and Escape while creating', async () => {
    let resolveRequest: (value: Project) => void = () => undefined;
    const requestCreate = vi.fn(
      () =>
        new Promise<Project>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const onCancel = vi.fn();
    const onCreated = vi.fn();

    render(
      <CreateProjectDialog
        onCancel={onCancel}
        onCreated={onCreated}
        requestCreate={requestCreate}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    fillValidForm();
    const submit = screen.getByRole('button', { name: 'Create project' });
    const form = submit.closest('form');

    fireEvent.click(submit);
    fireEvent.submit(form!);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(requestCreate).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/^Short description/) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();

    resolveRequest(project);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
  });

  it('preserves the draft after failure and retries the same trimmed values', async () => {
    const requestCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(project);
    const onCreated = vi.fn();

    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        requestCreate={requestCreate}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await screen.findByRole('alert');

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('  Launch plan  ');
    expect((screen.getByLabelText(/^Short description/) as HTMLTextAreaElement).value).toBe(
      '  Explore the launch constraints.  ',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(requestCreate).toHaveBeenCalledTimes(2);
    expect(requestCreate).toHaveBeenLastCalledWith({
      title: 'Launch plan',
      description: 'Explore the launch constraints.',
    });
  });

  it('supports both Cancel and Escape before submission', () => {
    const cancelFromButton = vi.fn();
    const firstRender = render(
      <CreateProjectDialog
        onCancel={cancelFromButton}
        onCreated={vi.fn()}
        requestCreate={vi.fn()}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelFromButton).toHaveBeenCalledTimes(1);

    firstRender.unmount();

    const cancelFromEscape = vi.fn();
    render(
      <CreateProjectDialog
        onCancel={cancelFromEscape}
        onCreated={vi.fn()}
        requestCreate={vi.fn()}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancelFromEscape).toHaveBeenCalledTimes(1);
  });

  it('hands optional selected documents off only after creating the project', async () => {
    const requestCreate = vi.fn().mockResolvedValue(project);
    const onCreated = vi.fn();
    const brief = new File(['Launch notes'], 'launch-brief.txt', {
      type: 'text/plain',
    });
    const risks = new File(['Known risks'], 'risks.txt', {
      type: 'text/plain',
    });

    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        requestCreate={requestCreate}
        requestDocumentPolicy={requestDocumentPolicy}
      />,
    );

    const documentInput = await screen.findByLabelText(/^Documents/);
    expect(documentInput.getAttribute('accept')).toBe('.txt');
    expect(screen.getByText(/TXT · Up to 10 MiB per file/)).toBeTruthy();

    fireEvent.change(documentInput, {
      target: { files: [brief, risks] },
    });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByText('launch-brief.txt')).toBeTruthy();
    expect(screen.getByText('risks.txt')).toBeTruthy();

    fillValidForm();
    expect(screen.getByText('2 DOCUMENTS')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(project, [brief, risks]),
    );
    expect(requestCreate).toHaveBeenCalledTimes(1);
    expect(requestCreate.mock.invocationCallOrder[0]).toBeLessThan(
      onCreated.mock.invocationCallOrder[0],
    );
  });

  it('closes and navigates to the returned project canvas after successful creation', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL
            ? input
            : input.url,
        );
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.pathname === '/projects') {
          return { ok: true, json: async () => [] };
        }
        if (method === 'GET' && url.pathname === '/document-upload-policy') {
          return { ok: true, json: async () => documentUploadPolicy };
        }
        if (method === 'POST' && url.pathname === '/projects') {
          return { ok: true, json: async () => project };
        }
        if (method === 'GET' && url.pathname === '/projects/project-123') {
          return { ok: true, json: async () => project };
        }
        if (
          method === 'GET' &&
          (url.pathname === '/projects/project-123/bubbles' ||
            url.pathname === '/projects/project-123/bubble-links')
        ) {
          return { ok: true, json: async () => [] };
        }

        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(window.location.pathname).toBe('/projects/project-123'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText("Nothing here yet — that's on purpose.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const createCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input));
      return url.pathname === '/projects' && init?.method === 'POST';
    });
    expect(createCall?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        title: 'Launch plan',
        description: 'Explore the launch constraints.',
      }),
    });
    expect(
      fetchMock.mock.calls.map(([input]) => String(input)),
    ).toEqual(
      expect.arrayContaining([
        'http://localhost:3000/projects/project-123',
        'http://localhost:3000/projects/project-123/bubbles',
        'http://localhost:3000/projects/project-123/bubble-links',
      ]),
    );
  });
});
