import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import type { Project } from '../src/api';
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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: '  Launch plan  ' },
  });
  fireEvent.change(screen.getByLabelText(/^Short description/), {
    target: { value: '  Explore the launch constraints.  ' },
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
      />,
    );

    const title = screen.getByLabelText(/^Title/);
    const description = screen.getByLabelText(/^Short description/);
    const submit = screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement;

    expect(document.activeElement).toBe(title);
    expect(submit.disabled).toBe(true);
    expect(description.getAttribute('maxlength')).toBe('280');
    expect(screen.getByText('0 / 280')).toBeTruthy();

    fillValidForm();

    expect(submit.disabled).toBe(false);
    expect(screen.getByText('35 / 280')).toBeTruthy();
    expect(screen.getByText('2 FIELDS · NO SETUP')).toBeTruthy();
  });

  it('keeps whitespace-only fields invalid and exposes field-level errors after blur', () => {
    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        requestCreate={vi.fn()}
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
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancelFromEscape).toHaveBeenCalledTimes(1);
  });

  it('closes and navigates to the returned project canvas after successful creation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => project,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => project,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(window.location.pathname).toBe('/projects/project-123'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText("Nothing here yet — that's on purpose.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        title: 'Launch plan',
        description: 'Explore the launch constraints.',
      }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://localhost:3000/projects/project-123');
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'http://localhost:3000/projects/project-123/bubbles',
    );
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      'http://localhost:3000/projects/project-123/bubble-links',
    );
  });
});
