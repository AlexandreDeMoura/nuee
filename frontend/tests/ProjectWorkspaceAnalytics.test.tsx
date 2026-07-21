import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import {
  analytics,
  browserAnalyticsEventName,
  type AnalyticsClient,
  type AnalyticsEvent,
} from '../src/analytics';
import type { Project } from '../src/api';
import { ProjectDescriptionEditor } from '../src/projects/ProjectDescriptionEditor';
import { ProjectCanvasRoute } from '../src/workspace/ProjectCanvasRoute';
import { ProjectWorkspace } from '../src/workspace/ProjectWorkspace';

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

function createAnalyticsSpy() {
  const track = vi.fn<AnalyticsClient['track']>();
  const analyticsClient: AnalyticsClient = { track };

  return { analyticsClient, track };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

function fillCreateProjectForm() {
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: project.title },
  });
  fireEvent.change(screen.getByLabelText(/^Short description/), {
    target: { value: project.description },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('project workspace analytics contract', () => {
  it('publishes typed events through the vendor-neutral browser boundary', () => {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(browserAnalyticsEventName, listener);

    analytics.track('project_panel_viewed', {
      project_id: project.id,
      view: 'documents',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<AnalyticsEvent>;
    expect(event.detail).toEqual({
      event: 'project_panel_viewed',
      properties: {
        project_id: project.id,
        view: 'documents',
      },
    });

    window.removeEventListener(browserAnalyticsEventName, listener);
  });

  it('records one creation and one opening after a failed creation retry and automatic navigation', async () => {
    const { analyticsClient, track } = createAnalyticsSpy();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(jsonResponse(project))
      .mockResolvedValueOnce(jsonResponse(project));
    vi.stubGlobal('fetch', fetchMock);

    render(<App analyticsClient={analyticsClient} />);

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fillCreateProjectForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await screen.findByText('Couldn’t create the project');
    expect(track).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText("Nothing here yet — that's on purpose.")).toBeTruthy();
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2));
    expect(track.mock.calls).toEqual([
      ['project_created', { project_id: project.id }],
      ['project_opened', { project_id: project.id }],
    ]);
  });

  it('records a project opening only after a route retry succeeds', async () => {
    const { analyticsClient, track } = createAnalyticsSpy();
    const requestProject = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(project);

    render(
      <ProjectCanvasRoute
        analyticsClient={analyticsClient}
        projectId={project.id}
        requestProject={requestProject}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText("Nothing here yet — that's on purpose.")).toBeTruthy();
    expect(track.mock.calls).toEqual([
      ['project_opened', { project_id: project.id }],
    ]);
  });

  it('records a description update only when the retry saves successfully', async () => {
    const { analyticsClient, track } = createAnalyticsSpy();
    const updatedProject = {
      ...project,
      description: 'A saved description.',
      updated_at: '2026-07-20T10:01:00.000Z',
    };
    const requestUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(updatedProject);

    render(
      <ProjectDescriptionEditor
        analyticsClient={analyticsClient}
        onProjectSaved={vi.fn()}
        project={project}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project description'), {
      target: { value: updatedProject.description },
    });

    await screen.findByText('Couldn’t save the description');
    expect(track).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('project_description_updated', {
        project_id: project.id,
      }),
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('records minimal properties for panel changes and empty-state actions', () => {
    const { analyticsClient, track } = createAnalyticsSpy();

    render(<ProjectWorkspace analyticsClient={analyticsClient} project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start a discussion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create a bubble' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload a document' }));

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    fireEvent.click(projectTab);
    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Discussions' }), {
      key: 'ArrowDown',
    });

    expect(track.mock.calls).toEqual([
      [
        'project_empty_action_selected',
        { project_id: project.id, action: 'start_discussion' },
      ],
      [
        'project_empty_action_selected',
        { project_id: project.id, action: 'create_bubble' },
      ],
      [
        'project_empty_action_selected',
        { project_id: project.id, action: 'upload_document' },
      ],
      [
        'project_panel_viewed',
        { project_id: project.id, view: 'discussions' },
      ],
      [
        'project_panel_viewed',
        { project_id: project.id, view: 'documents' },
      ],
    ]);
  });
});
