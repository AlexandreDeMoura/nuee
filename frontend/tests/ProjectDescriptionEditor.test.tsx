import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import type { Project } from '../src/api';
import { ProjectDescriptionEditor } from '../src/projects/ProjectDescriptionEditor';
import { ProjectWorkspace } from '../src/workspace/ProjectWorkspace';
import { useCurrentProjectDescription } from '../src/workspace/currentProjectDescription';

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

function projectWithDescription(description: string, milliseconds = 1): Project {
  return {
    ...project,
    description,
    updated_at: `2026-07-20T10:00:00.${milliseconds.toString().padStart(3, '0')}Z`,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function CurrentDescriptionProbe() {
  const { projectId, currentDescription } = useCurrentProjectDescription();

  return <output aria-label="Current project description">{`${projectId}:${currentDescription}`}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('ProjectDescriptionEditor', () => {
  it('debounces rapid edits and persists only the latest draft', async () => {
    const updatedProject = projectWithDescription('The final description.');
    const requestUpdate = vi.fn().mockResolvedValue(updatedProject);
    const onProjectSaved = vi.fn();

    render(
      <ProjectDescriptionEditor
        project={project}
        onProjectSaved={onProjectSaved}
        requestUpdate={requestUpdate}
        saveDelayMs={10}
      />,
    );

    const editor = screen.getByLabelText('Project description');
    fireEvent.change(editor, { target: { value: 'The first edit.' } });
    fireEvent.change(editor, { target: { value: 'A newer edit.' } });
    fireEvent.change(editor, { target: { value: '  The final description.  ' } });

    expect(screen.getByText('UNSAVED')).toBeTruthy();

    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));
    expect(requestUpdate).toHaveBeenCalledWith(
      project.id,
      { description: 'The final description.' },
      expect.any(AbortSignal),
    );

    await waitFor(() => expect(onProjectSaved).toHaveBeenCalledWith(updatedProject));
    expect((editor as HTMLTextAreaElement).value).toBe('The final description.');
    expect(screen.getByText('All changes saved.')).toBeTruthy();
  });

  it('serializes edits made during a save and never replaces the newer draft', async () => {
    const firstSave = deferred<Project>();
    const secondSave = deferred<Project>();
    const requestUpdate = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const onProjectSaved = vi.fn();

    render(
      <ProjectDescriptionEditor
        project={project}
        onProjectSaved={onProjectSaved}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    const editor = screen.getByLabelText('Project description') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'First saved version.' } });
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));

    fireEvent.change(editor, { target: { value: 'Final saved version.' } });
    expect(editor.value).toBe('Final saved version.');

    await act(async () => {
      firstSave.resolve(projectWithDescription('First saved version.', 1));
    });

    expect(editor.value).toBe('Final saved version.');
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(2));
    expect(requestUpdate.mock.calls[1]?.[1]).toEqual({
      description: 'Final saved version.',
    });

    const finalProject = projectWithDescription('Final saved version.', 2);
    await act(async () => {
      secondSave.resolve(finalProject);
    });

    await waitFor(() => expect(onProjectSaved).toHaveBeenLastCalledWith(finalProject));
    expect(editor.value).toBe('Final saved version.');
    expect(screen.getByText('All changes saved.')).toBeTruthy();
  });

  it('retains a failed draft and retries it explicitly', async () => {
    const updatedProject = projectWithDescription('A recoverable draft.');
    const requestUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(updatedProject);
    const onProjectSaved = vi.fn();

    render(
      <ProjectDescriptionEditor
        project={project}
        onProjectSaved={onProjectSaved}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    const editor = screen.getByLabelText('Project description') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'A recoverable draft.' } });

    expect(await screen.findByText('Couldn’t save the description')).toBeTruthy();
    expect(editor.value).toBe('A recoverable draft.');
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));

    await waitFor(() => expect(onProjectSaved).toHaveBeenCalledWith(updatedProject));
    expect(requestUpdate).toHaveBeenCalledTimes(2);
    expect(editor.value).toBe('A recoverable draft.');
  });

  it('validates an empty description without sending it', async () => {
    const requestUpdate = vi.fn();

    render(
      <ProjectDescriptionEditor
        project={project}
        onProjectSaved={vi.fn()}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    const editor = screen.getByLabelText('Project description');
    fireEvent.change(editor, { target: { value: '   ' } });

    expect(await screen.findByText('A project description is required.')).toBeTruthy();
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('aborts a pending save and ignores its response after unmount', async () => {
    const pendingSave = deferred<Project>();
    const requestUpdate = vi.fn(
      (projectId: string, input: { description: string }, signal?: AbortSignal) => {
        void projectId;
        void input;
        void signal;
        return pendingSave.promise;
      },
    );
    const onProjectSaved = vi.fn();
    const rendered = render(
      <ProjectDescriptionEditor
        project={project}
        onProjectSaved={onProjectSaved}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project description'), {
      target: { value: 'Pending navigation draft.' },
    });
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));

    const signal = requestUpdate.mock.calls[0]?.[2];
    rendered.unmount();

    expect(signal?.aborted).toBe(true);

    await act(async () => {
      pendingSave.resolve(projectWithDescription('Pending navigation draft.'));
    });
    expect(onProjectSaved).not.toHaveBeenCalled();
  });
});

describe('project description integration', () => {
  it('updates the header and read-only discussion context only after a successful save', async () => {
    const pendingSave = deferred<Project>();
    const requestUpdate = vi.fn(
      (projectId: string, input: { description: string }, signal?: AbortSignal) => {
        void projectId;
        void input;
        void signal;
        return pendingSave.promise;
      },
    );

    render(
      <ProjectWorkspace
        project={project}
        primaryActions={<CurrentDescriptionProbe />}
        requestDescriptionUpdate={requestUpdate}
        descriptionSaveDelayMs={0}
      />,
    );

    const context = screen.getByLabelText('Current project description');
    const editor = screen.getByLabelText('Project description');
    expect(context.textContent).toBe(`${project.id}:${project.description}`);

    fireEvent.change(editor, { target: { value: 'New discussion context.' } });
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));
    expect(context.textContent).toBe(`${project.id}:${project.description}`);

    const updatedProject = projectWithDescription('New discussion context.');
    await act(async () => {
      pendingSave.resolve(updatedProject);
    });

    await waitFor(() =>
      expect(context.textContent).toBe(`${project.id}:New discussion context.`),
    );
    expect(document.querySelector('header p')?.textContent).toBe('New discussion context.');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(project.title);
  });

  it('keeps an editor mounted while switching panels so its draft still saves', async () => {
    const updatedProject = projectWithDescription('Saved while discussions are open.');
    const requestUpdate = vi.fn().mockResolvedValue(updatedProject);

    render(
      <ProjectWorkspace
        project={project}
        requestDescriptionUpdate={requestUpdate}
        descriptionSaveDelayMs={10}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project description'), {
      target: { value: updatedProject.description },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discussions' }));

    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect((screen.getByLabelText('Project description') as HTMLTextAreaElement).value).toBe(
      updatedProject.description,
    );
  });

  it('loads the persisted description again after the project route remounts', async () => {
    const updatedProject = projectWithDescription('Persisted across reloads.');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: true, json: async () => updatedProject })
      .mockResolvedValueOnce({ ok: true, json: async () => updatedProject });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', `/projects/${project.id}`);

    const firstRender = render(<App />);
    const editor = (await screen.findByLabelText('Project description')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: updatedProject.description } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `http://localhost:3000/projects/${project.id}/description`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ description: updatedProject.description }),
    });

    firstRender.unmount();
    render(<App />);

    const reloadedEditor = (await screen.findByLabelText(
      'Project description',
    )) as HTMLTextAreaElement;
    expect(reloadedEditor.value).toBe(updatedProject.description);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
