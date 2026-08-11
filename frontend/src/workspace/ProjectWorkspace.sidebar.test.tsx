import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../api';
import type { AnalyticsClient } from '../analytics';
import { ProjectWorkspace } from './ProjectWorkspace';

afterEach(cleanup);

const project: Project = {
  id: 'project-one',
  title: 'Sidebar project',
  description: 'A project whose panel can be collapsed to its rail.',
  created_at: '2026-08-11T10:00:00.000Z',
  updated_at: '2026-08-11T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

function renderWorkspace(track = vi.fn<AnalyticsClient['track']>()) {
  render(
    <ProjectWorkspace
      analyticsClient={{ track }}
      project={project}
      requestBubbleLinks={async () => []}
      requestBubbles={async () => []}
    />,
  );

  return { track };
}

describe('ProjectWorkspace panel collapsing', () => {
  it('collapses to the rail icons and back from the toggle', () => {
    const { track } = renderWorkspace();

    expect(screen.getByRole('tabpanel')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));

    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label')),
    ).toEqual(['Discussions', 'Documents', 'Project', 'Inspector']);
    expect(
      screen.getByRole('tab', { name: 'Project' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(track).toHaveBeenCalledWith('project_panel_collapsed', {
      project_id: project.id,
      collapsed: true,
      source: 'rail_toggle',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show panel' }));

    expect(screen.getByRole('tabpanel')).not.toBeNull();
  });

  it('toggles the panel from the keyboard shortcut', () => {
    const { track } = renderWorkspace();

    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(track).toHaveBeenCalledWith('project_panel_collapsed', {
      project_id: project.id,
      collapsed: true,
      source: 'shortcut',
    });

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    expect(screen.getByRole('tabpanel')).not.toBeNull();
    expect(track).toHaveBeenLastCalledWith('project_panel_collapsed', {
      project_id: project.id,
      collapsed: false,
      source: 'shortcut',
    });
  });

  it('ignores the shortcut when a modifier chord does not match', () => {
    renderWorkspace();

    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.keyDown(window, { key: 'b', metaKey: true, shiftKey: true });

    expect(screen.getByRole('tabpanel')).not.toBeNull();
  });

  it('collapses from the active tab and reopens on another panel', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('tab', { name: 'Project' }));

    expect(screen.queryByRole('tabpanel')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'workspace-panel-tab-discussions',
    );
  });

  it('keeps the panel collapsed while arrow keys rove the rail', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Project' }), {
      key: 'ArrowDown',
    });

    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: 'Inspector' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });
});
