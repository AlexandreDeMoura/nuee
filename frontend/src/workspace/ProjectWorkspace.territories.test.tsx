import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble, Project, Territory } from '../api';
import { ProjectWorkspace } from './ProjectWorkspace';

afterEach(cleanup);

const project: Project = {
  id: 'project-one',
  title: 'Territory project',
  description: 'A project grouped into territories.',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

function territoryFixture(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-one',
    project_id: project.id,
    kind: 'composed',
    title: 'Operations',
    position_x: 0,
    position_y: 0,
    visible_count: 1,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function bubbleFixture(index: number): Bubble {
  return {
    id: `bubble-${index}`,
    project_id: project.id,
    territory_id: 'territory-one',
    title: `Bubble ${index}`,
    summary: `Summary ${index}`,
    content: `Content ${index}`,
    created_at: `2026-08-01T10:0${index}:00.000Z`,
    updated_at: `2026-08-01T10:0${index}:00.000Z`,
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
  };
}

describe('ProjectWorkspace territory save status', () => {
  it('surfaces an in-flight visible-count save in the existing header indicator', async () => {
    let resolveUpdate!: (territory: Territory) => void;
    const requestTerritoryVisibleCountUpdate = vi.fn(
      () =>
        new Promise<Territory>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    render(
      <ProjectWorkspace
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => [bubbleFixture(1), bubbleFixture(2)]}
        requestTerritories={async () => [territoryFixture()]}
        requestTerritoryVisibleCountUpdate={
          requestTerritoryVisibleCountUpdate
        }
        visibleCountSaveDelayMs={0}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show more bubbles in Operations',
      }),
    );

    await waitFor(() => {
      expect(requestTerritoryVisibleCountUpdate).toHaveBeenCalledWith(
        project.id,
        'territory-one',
        { visible_count: 2 },
      );
      expect(screen.getByText('SAVING')).not.toBeNull();
    });

    resolveUpdate(
      territoryFixture({
        updated_at: '2026-08-01T10:01:00.000Z',
        visible_count: 2,
      }),
    );
    await waitFor(() => expect(screen.queryByText('SAVING')).toBeNull());
  });
});
