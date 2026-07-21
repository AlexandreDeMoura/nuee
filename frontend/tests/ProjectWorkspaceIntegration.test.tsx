import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../src/api';
import {
  ProjectWorkspace,
  type WorkspaceInspectorSelection,
} from '../src/workspace/ProjectWorkspace';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('workspace integration contracts', () => {
  it('dispatches each empty-canvas action to its owning feature callback', () => {
    const startDiscussion = vi.fn();
    const createBubble = vi.fn();
    const uploadDocument = vi.fn();

    render(
      <ProjectWorkspace
        project={project}
        emptyActionHandlers={{
          'start-discussion': startDiscussion,
          'create-bubble': createBubble,
          'upload-document': uploadDocument,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start a discussion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create a bubble' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload a document' }));

    expect(startDiscussion).toHaveBeenCalledTimes(1);
    expect(createBubble).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('shows one supplied panel at a time and does not navigate while switching', () => {
    window.history.replaceState({}, '', `/projects/${project.id}`);

    render(
      <ProjectWorkspace
        project={project}
        panelSlots={{
          discussions: <p>Supplied discussion list</p>,
          documents: <p>Supplied document list</p>,
          project: <p>Supplied project editor</p>,
        }}
      />,
    );

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    const discussionsTab = screen.getByRole('tab', { name: 'Discussions' });
    const documentsTab = screen.getByRole('tab', { name: 'Documents' });

    expect(projectTab.getAttribute('aria-selected')).toBe('true');
    expect(projectTab.getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Supplied project editor')).toBeTruthy();
    expect(screen.queryByText('Supplied discussion list')).toBeNull();

    fireEvent.click(discussionsTab);

    expect(discussionsTab.getAttribute('aria-selected')).toBe('true');
    expect(projectTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('Supplied discussion list')).toBeTruthy();
    expect(screen.queryByText('Supplied project editor')).toBeNull();

    fireEvent.click(documentsTab);

    expect(documentsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Supplied document list')).toBeTruthy();
    expect(screen.queryByText('Supplied discussion list')).toBeNull();
    expect(window.location.pathname).toBe(`/projects/${project.id}`);
  });

  it('provides intentional empty states for unsupplied collection panels', () => {
    render(<ProjectWorkspace project={project} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    expect(screen.getByText('No discussions yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.queryByText('No discussions yet')).toBeNull();
  });

  it('gates Inspector content on a valid selection and clears invalid details', () => {
    const validSelection: WorkspaceInspectorSelection = {
      id: 'bubble-42',
      kind: 'bubble',
    };
    const onInvalidated = vi.fn();
    const rendered = render(
      <ProjectWorkspace
        project={project}
        inspectorSelection={validSelection}
        onInspectorSelectionInvalidated={onInvalidated}
        panelSlots={{
          inspector: (selection) => <p>Inspecting {selection.id}</p>,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    expect(screen.getByText('Inspecting bubble-42')).toBeTruthy();
    expect(screen.queryByText('Nothing selected')).toBeNull();

    const invalidSelection: WorkspaceInspectorSelection = {
      ...validSelection,
      isValid: false,
    };
    rendered.rerender(
      <ProjectWorkspace
        project={project}
        inspectorSelection={invalidSelection}
        onInspectorSelectionInvalidated={onInvalidated}
        panelSlots={{
          inspector: (selection) => <p>Inspecting {selection.id}</p>,
        }}
      />,
    );

    expect(screen.queryByText('Inspecting bubble-42')).toBeNull();
    expect(screen.getByText('Nothing selected')).toBeTruthy();
    expect(onInvalidated).toHaveBeenCalledWith(invalidSelection);
  });

  it('supports focus-moving keyboard navigation and named native tooltips', () => {
    render(<ProjectWorkspace project={project} />);

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    expect(projectTab.getAttribute('title')).toBe('Project');

    projectTab.focus();
    fireEvent.keyDown(projectTab, { key: 'ArrowDown' });

    const inspectorTab = screen.getByRole('tab', { name: 'Inspector' });
    expect(document.activeElement).toBe(inspectorTab);
    expect(inspectorTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Nothing selected')).toBeTruthy();

    fireEvent.keyDown(inspectorTab, { key: 'Home' });

    const discussionsTab = screen.getByRole('tab', { name: 'Discussions' });
    expect(document.activeElement).toBe(discussionsTab);
    expect(discussionsTab.getAttribute('aria-selected')).toBe('true');
  });
});
