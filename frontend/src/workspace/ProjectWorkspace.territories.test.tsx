import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Bubble,
  CreateTerritoryInput,
  Project,
  Territory,
} from '../api';
import type { AnalyticsClient } from '../analytics';
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
    kind: 'manual',
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
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <ProjectWorkspace
        analyticsClient={{ track }}
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
    expect(track).toHaveBeenCalledWith(
      'territory_visible_count_changed',
      {
        project_id: project.id,
        territory_id: 'territory-one',
        bubble_count: 2,
        previous_visible_count: 1,
        visible_count: 2,
      },
    );

    resolveUpdate(
      territoryFixture({
        updated_at: '2026-08-01T10:01:00.000Z',
        visible_count: 2,
      }),
    );
    await waitFor(() => expect(screen.queryByText('SAVING')).toBeNull());
  });

  it('creates a viewport-centered empty territory from the action bar', async () => {
    const requestTerritoryCreate = vi.fn(
      async (_projectId: string, input: CreateTerritoryInput) =>
        territoryFixture({
          id: 'territory-created',
          title: input.title,
          position_x: input.position_x,
          position_y: input.position_y,
          visible_count: 4,
        }),
    );

    render(
      <ProjectWorkspace
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => [bubbleFixture(1)]}
        requestTerritories={async () => [territoryFixture()]}
        requestTerritoryCreate={requestTerritoryCreate}
      />,
    );

    const territoryAction = await screen.findByRole('button', {
      name: 'Territory',
    });
    territoryAction.focus();
    fireEvent.click(territoryAction);
    const titleInput = screen.getByLabelText('Title *');
    expect(document.activeElement).toBe(titleInput);
    fireEvent.change(titleInput, { target: { value: '  Pricing research  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create territory' }));

    await waitFor(() => {
      expect(requestTerritoryCreate).toHaveBeenCalledWith(project.id, {
        title: 'Pricing research',
        position_x: -260,
        position_y: -66,
      });
    });
    expect(await screen.findByText('Pricing research')).not.toBeNull();
    expect(
      screen.getByText('This territory doesn’t hold any bubbles yet.'),
    ).not.toBeNull();
    expect(screen.getByText('1 bubble · 2 territories')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(territoryAction));
    expect(
      screen.queryByRole('button', { name: 'Recompose territories' }),
    ).toBeNull();
  });

  it('opens the reader from the chevron and hands editing to the inspector', async () => {
    const track = vi.fn<AnalyticsClient['track']>();
    render(
      <ProjectWorkspace
        analyticsClient={{ track }}
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => [bubbleFixture(1)]}
        requestTerritories={async () => [territoryFixture()]}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Bubble 1' }),
    );
    expect(
      screen
        .getByRole('dialog')
        .getAttribute('data-bubble-reader-bubble-id'),
    ).toBe('bubble-1');
    expect(track).toHaveBeenCalledWith(
      'bubble_reader_opened_from_canvas',
      {
        project_id: project.id,
        bubble_id: 'bubble-1',
        territory_id: 'territory-one',
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Inspector' }).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
  });

  it('preserves bubble-id multi-selection from territory rows', async () => {
    const onConfirm = vi.fn();
    const bubbles = [bubbleFixture(1), bubbleFixture(2)];

    render(
      <ProjectWorkspace
        canvasMultiSelection={{
          onCancel: vi.fn(),
          onConfirm,
        }}
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => bubbles}
        requestTerritories={async () => [territoryFixture({ visible_count: 2 })]}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Bubble 1' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm selection (1 selected)' }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      projectId: project.id,
      bubbleIds: ['bubble-1'],
      bubbles: [bubbles[0]],
    });
  });
});
