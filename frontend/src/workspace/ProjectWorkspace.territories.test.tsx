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

  it('recomposes once, shows progress, and replaces the canvas collection from the response', async () => {
    let resolveRecompose!: (value: {
      bubbles: Bubble[];
      territories: Territory[];
    }) => void;
    const requestRecomposeTerritories = vi.fn(
      () =>
        new Promise<{ bubbles: Bubble[]; territories: Territory[] }>(
          (resolve) => {
            resolveRecompose = resolve;
          },
        ),
    );
    const initialBubbles = [bubbleFixture(1), bubbleFixture(2)];
    const recomposedTerritory = territoryFixture({
      id: 'territory-recomposed',
      title: 'Launch readiness',
      visible_count: 2,
    });
    const recomposedBubbles = initialBubbles.map((bubble) => ({
      ...bubble,
      territory_id: recomposedTerritory.id,
    }));

    render(
      <ProjectWorkspace
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => initialBubbles}
        requestRecomposeTerritories={requestRecomposeTerritories}
        requestTerritories={async () => [territoryFixture()]}
      />,
    );

    const action = await screen.findByRole('button', {
      name: 'Recompose territories',
    });
    fireEvent.click(action);
    fireEvent.click(action);

    expect(requestRecomposeTerritories).toHaveBeenCalledTimes(1);
    expect(requestRecomposeTerritories).toHaveBeenCalledWith(project.id, {});
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Recomposing territories',
      }).disabled,
    ).toBe(true);

    resolveRecompose({
      bubbles: recomposedBubbles,
      territories: [recomposedTerritory],
    });

    expect(await screen.findByText('Launch readiness')).not.toBeNull();
    expect(screen.queryByText('Operations')).toBeNull();
    expect(screen.getByText('2 bubbles · 1 territory')).not.toBeNull();
  });

  it('keeps the prior composition on failure and exposes retry', async () => {
    const requestRecomposeTerritories = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce({
        bubbles: [bubbleFixture(1), bubbleFixture(2)],
        territories: [territoryFixture()],
      });

    render(
      <ProjectWorkspace
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => [bubbleFixture(1), bubbleFixture(2)]}
        requestRecomposeTerritories={requestRecomposeTerritories}
        requestTerritories={async () => [territoryFixture()]}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Recompose territories' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Recompose failed',
    );
    expect(screen.getByText('Operations')).not.toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry recompose territories' }),
    );
    await waitFor(() =>
      expect(requestRecomposeTerritories).toHaveBeenCalledTimes(2),
    );
  });

  it('opens the reader from the chevron and hands editing to the inspector', async () => {
    render(
      <ProjectWorkspace
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
